import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, firstValueFrom, map, shareReplay, switchMap, tap } from 'rxjs';
import type { AuthResponse, UserProfile } from '@bill-tracker/shared-types';
import { AuthApi } from '../api/auth.api';
import { UsersApi } from '../api/users.api';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly authApi = inject(AuthApi);
  private readonly usersApi = inject(UsersApi);

  /**
   * The access token lives here and nowhere else — never `localStorage`,
   * never `sessionStorage`, never a cookie the client writes. Cross-site
   * scripting cannot exfiltrate a credential that is not durable.
   */
  private readonly token = signal<string | null>(null);
  private readonly currentUser = signal<UserProfile | null>(null);

  private inFlightRefresh: Observable<string> | null = null;
  private refreshGeneration = 0;

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  accessToken(): string | null {
    return this.token();
  }

  signIn(response: AuthResponse): void {
    this.resetRefresh();
    this.token.set(response.accessToken);
    this.currentUser.set(response.user);
  }

  /**
   * Replaces the profile without touching the token or the refresh state.
   * Saving a name is not a sign-in, and routing it through `signIn` would
   * discard an in-flight refresh for no reason.
   */
  setUser(user: UserProfile): void {
    this.currentUser.set(user);
  }

  clear(): void {
    this.resetRefresh();
    this.token.set(null);
    this.currentUser.set(null);
  }

  /**
   * Rebuilds the session at boot from the refresh cookie.
   *
   * Two round trips, because `POST /api/auth/refresh` returns only the
   * access token. **This never rejects**: a 401 is the ordinary state of a
   * visitor who is not signed in, and a rejected app initializer fails
   * bootstrap outright.
   *
   * A token without a profile is not a usable session — it renders a shell
   * with no name and no way to recover — so a failed profile read clears
   * everything rather than leaving half a session behind.
   */
  async restore(): Promise<void> {
    try {
      // Chained with `switchMap` rather than two `await`ed calls: the
      // testing backend's `flush()` resolves synchronously, and an `await`
      // between the two requests would push the second one behind a
      // microtask tick the test never yields to. Staying inside one RxJS
      // pipeline keeps the second request's dispatch synchronous with the
      // first response.
      await firstValueFrom(
        this.authApi.refresh().pipe(
          switchMap(({ accessToken }) => {
            this.token.set(accessToken);
            return this.usersApi.me({ skipAuthRetry: true });
          }),
          tap((user) => this.currentUser.set(user)),
        ),
      );
    } catch {
      this.clear();
    }
  }

  /**
   * Single-flight refresh: however many requests fail with 401 at once,
   * exactly one `POST /api/auth/refresh` goes out and they all wait on it.
   *
   * The server tolerates a stampede through its 30-second grace window
   * (foundation spec §7), which exists so that client correctness is
   * optional. Depending on that is still the wrong instinct, and
   * single-flighting means the window is never exercised in normal use.
   *
   * The generation counter stops a late `finalize` from clearing a *newer*
   * in-flight refresh that `clear()` or `signIn()` started in between.
   */
  refresh(): Observable<string> {
    if (this.inFlightRefresh) return this.inFlightRefresh;

    const generation = ++this.refreshGeneration;
    const shared = this.authApi.refresh().pipe(
      map((response) => response.accessToken),
      tap((accessToken) => {
        // The refresh request is never cancelled (refCount: false), so it
        // can outlive the session that started it. Writing this token now
        // would leave a signed-out session holding a live credential.
        if (this.refreshGeneration !== generation) {
          throw new Error('Refresh superseded by a newer session');
        }
        this.token.set(accessToken);
      }),
      finalize(() => {
        if (this.refreshGeneration === generation) this.inFlightRefresh = null;
      }),
      // No `scheduler` and no `windowTime`: either would introduce an
      // async boundary between the source emitting and subscribers
      // receiving it, which breaks the single-flight contract callers
      // rely on — concurrent callers must see the same emission, not a
      // deferred replay of it.
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.inFlightRefresh = shared;
    return shared;
  }

  /**
   * Performs the sign-out half of a failed refresh — once per refresh
   * cycle, and only while that cycle still belongs to the current session.
   *
   * Every waiter on the shared observable reaches the interceptor's
   * failure branch, so this must be idempotent. `clear()` nulls
   * `inFlightRefresh`, so the first caller's identity check succeeds and
   * every later one fails. A cycle that was superseded by `clear()` or
   * `signIn()` is no longer the in-flight one either, so a refresh that
   * outlived its session cannot sign out the session that replaced it.
   *
   * Returns whether it acted, so the caller knows whether to navigate.
   */
  failRefresh(cycle: Observable<string>): boolean {
    if (this.inFlightRefresh !== cycle) return false;
    this.clear();
    return true;
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.authApi.logout());
    } catch {
      // The session ends either way. Keeping someone signed in because the
      // server was unreachable is the wrong failure to pick.
    }
    this.clear();
  }

  private resetRefresh(): void {
    this.refreshGeneration += 1;
    this.inFlightRefresh = null;
  }
}

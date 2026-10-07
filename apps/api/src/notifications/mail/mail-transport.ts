export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * An abstract class rather than an interface plus an injection token:
 * Nest can use the class itself as the token, so consumers write
 * `constructor(private readonly mail: MailTransport)` with no `@Inject`.
 *
 * Plain text only. An HTML body needs a template system, an escaping
 * story, and a multipart builder, for a message that is a list of bills
 * with dates and amounts.
 */
export abstract class MailTransport {
  abstract send(message: MailMessage): Promise<void>;
}

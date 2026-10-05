import {
  Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Patch,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { TokenService } from '../auth/token.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { User } from './user.entity';
import type { UserProfile } from '@bill-tracker/shared-types';

const toProfile = (user: User): UserProfile => ({
  id: user.id,
  email: user.email,
  name: user.name,
  notifyEmail: user.notifyEmail,
  notifyInApp: user.notifyInApp,
});

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Get('me')
  async me(@CurrentUser() userId: string): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return toProfile(user);
  }

  @Patch('me')
  async update(
    @CurrentUser() userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    return toProfile(await this.users.updateProfile(userId, dto));
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.users.changePassword(userId, dto.currentPassword, dto.newPassword);
    await this.tokens.revokeAllForUser(userId);
  }
}

import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { ActivityAction } from '../activity/activity.service';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mail: MailService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = this.hashToken(verificationToken);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: normalizedEmail,
        passwordHash,
        emailVerificationTokenHash: verificationTokenHash,
        emailVerificationSentAt: new Date(),
      },
      select: { id: true, email: true, name: true, role: true },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    try {
      await this.mail.sendVerificationEmail({
        to: user.email,
        name: user.name ?? undefined,
        verifyUrl: `${appUrl}/verify-email?token=${verificationToken}`,
      });
    } catch (err) {
      // If email fails, delete the user since registration requires email verification
      await this.prisma.user.delete({ where: { id: user.id } });
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Failed to send verification email: ${msg}`);
    }

    return {
      message: 'Account created. Please verify your email before signing in.',
      email: user.email,
    };
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (!user) throw new UnauthorizedException('No account found with that email address');

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Please verify your email before signing in');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Incorrect password');

    const tokens = await this.signTokens(user.id, user.email, user.role);
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    };
  }

  async verifyEmail(token: string) {
    const tokenHash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({
      where: { emailVerificationTokenHash: tokenHash },
      select: { id: true, emailVerificationSentAt: true, emailVerifiedAt: true },
    });

    if (!user) throw new BadRequestException('Invalid verification token');
    if (user.emailVerifiedAt) return { verified: true, message: 'Email is already verified' };

    const sentAt = user.emailVerificationSentAt?.getTime() ?? 0;
    const ageMs = Date.now() - sentAt;
    if (!sentAt || ageMs > 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Verification link has expired');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationSentAt: null,
      },
    });

    return { verified: true, message: 'Email verified successfully. You can now sign in.' };
  }

  async resendVerification(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });

    // Do not reveal whether the email exists.
    if (!user || user.emailVerifiedAt) {
      return { message: 'If an unverified account exists for this email, a new verification link has been sent.' };
    }

    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = this.hashToken(verificationToken);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationTokenHash: verificationTokenHash,
        emailVerificationSentAt: new Date(),
      },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    try {
      await this.mail.sendVerificationEmail({
        to: user.email,
        name: user.name ?? undefined,
        verifyUrl: `${appUrl}/verify-email?token=${verificationToken}`,
      });
    } catch (err) {
      // Log the error but don't expose it (for security)
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send verification email to ${user.email}: ${msg}`);
    }

    return { message: 'If an unverified account exists for this email, a new verification link has been sent.' };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });

    // Do not reveal whether the email exists.
    if (!user || !user.emailVerifiedAt) {
      return { message: 'If an account exists for this email, a password reset link has been sent.' };
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenHash = this.hashToken(resetToken);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: resetTokenHash,
        passwordResetSentAt: new Date(),
      },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    try {
      await this.mail.sendPasswordResetEmail({
        to: user.email,
        name: user.name ?? undefined,
        resetUrl: `${appUrl}/reset-password?token=${resetToken}`,
      });
    } catch (err) {
      // Log mail failures but keep generic response to avoid account enumeration.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send password reset email to ${user.email}: ${msg}`);
    }

    return { message: 'If an account exists for this email, a password reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({
      where: { passwordResetTokenHash: tokenHash },
      select: { id: true, passwordResetSentAt: true },
    });

    if (!user) throw new BadRequestException('Invalid reset token');

    const sentAt = user.passwordResetSentAt?.getTime() ?? 0;
    const ageMs = Date.now() - sentAt;
    if (!sentAt || ageMs > 60 * 60 * 1000) {
      throw new BadRequestException('Reset link has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetSentAt: null,
      },
    });

    return { message: 'Password reset successful. You can now sign in with your new password.' };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const nextHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: nextHash,
        passwordResetTokenHash: null,
        passwordResetSentAt: null,
      },
    });

    try {
      await this.mail.sendPasswordChangedEmail({
        to: user.email,
        name: user.name ?? undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send password changed email to ${user.email}: ${msg}`);
    }

    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
    });
    if (memberships.length > 0) {
      await this.prisma.activityLog.createMany({
        data: memberships.map((member) => ({
          orgId: member.organizationId,
          actorId: user.id,
          actorName: user.name ?? user.email,
          action: ActivityAction.ACCOUNT_PASSWORD_CHANGED,
          targetType: 'member',
          targetId: user.id,
          metadata: {
            source: 'account_settings',
          },
        })),
      });
    }

    return { message: 'Password updated successfully.' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return { user };
  }

  async refreshToken(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.signTokens(user.id, user.email, user.role);
  }

  async refreshFromToken(refreshToken: string) {
    const secret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Refresh token secret is not configured');
    }

    let payload: { sub: string; email: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.emailVerifiedAt) {
      throw new UnauthorizedException('User is not eligible for refresh');
    }

    const tokens = await this.signTokens(user.id, user.email, user.role);
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    };
  }

  private async signTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const refreshSecret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new UnauthorizedException('Refresh token secret is not configured');
    }

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, { expiresIn: '15m' }),
      this.jwt.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

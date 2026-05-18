import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
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
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenHash = this.hashToken(verificationToken);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        emailVerificationTokenHash: verificationTokenHash,
        emailVerificationSentAt: new Date(),
      },
      select: { id: true, email: true, name: true },
    });

    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
    await this.mail.sendVerificationEmail({
      to: user.email,
      name: user.name ?? undefined,
      verifyUrl: `${appUrl}/verify-email?token=${verificationToken}`,
    });

    return {
      message: 'Account created. Please verify your email before signing in.',
      email: user.email,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Please verify your email before signing in');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.signTokens(user.id, user.email);
    return {
      user: { id: user.id, email: user.email, name: user.name },
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
        emailVerificationTokenHash: null,
        emailVerificationSentAt: null,
      },
    });

    return { verified: true, message: 'Email verified successfully. You can now sign in.' };
  }

  async resendVerification(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
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
    await this.mail.sendVerificationEmail({
      to: user.email,
      name: user.name ?? undefined,
      verifyUrl: `${appUrl}/verify-email?token=${verificationToken}`,
    });

    return { message: 'If an unverified account exists for this email, a new verification link has been sent.' };
  }

  async refreshToken(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.signTokens(user.id, user.email);
  }

  private async signTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, { expiresIn: '15m' }),
      this.jwt.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MaxLength(100)
  declare name: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  declare email: string;

  @ApiProperty({ example: 'strongpassword' })
  @IsString()
  @MinLength(8)
  declare password: string;
}

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  declare email: string;

  @ApiProperty({ example: 'strongpassword' })
  @IsString()
  declare password: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'token-from-email-link' })
  @IsString()
  @MinLength(20)
  declare token: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  declare email: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  @IsString()
  @MinLength(20)
  declare refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  declare email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'token-from-reset-link' })
  @IsString()
  @MinLength(20)
  declare token: string;

  @ApiProperty({ example: 'newstrongpassword' })
  @IsString()
  @MinLength(8)
  declare password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'currentpassword' })
  @IsString()
  declare currentPassword: string;

  @ApiProperty({ example: 'newstrongpassword' })
  @IsString()
  @MinLength(8)
  declare newPassword: string;
}

import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CommunityEmailSignupDto {
  @IsEmail()
  declare email: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

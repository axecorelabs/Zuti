import { IsString, IsOptional, IsBoolean, IsInt, IsArray, IsDateString, Min, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class RegistrationFieldDto {
  @IsString() key: string;
  @IsString() label: string;
  @IsIn(['text', 'email', 'phone', 'number', 'select']) type: string;
  @IsBoolean() required: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
}

export class CreateRegistrationProductDto {
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsBoolean() isFree: boolean;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsString() currency?: string;
  @IsBoolean() requiresApproval: boolean;
  @IsOptional() @IsString() confirmationMessage?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RegistrationFieldDto) fields: RegistrationFieldDto[];
  @IsOptional() @IsString() botId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateRegistrationProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsBoolean() isFree?: boolean;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsString() confirmationMessage?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RegistrationFieldDto) fields?: RegistrationFieldDto[];
  @IsOptional() @IsString() botId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateRegistrationEntryDto {
  @IsIn(['CONFIRMED', 'CANCELLED']) status: 'CONFIRMED' | 'CANCELLED';
}

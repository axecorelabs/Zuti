import { IsString, IsOptional, IsBoolean, IsInt, IsArray, IsDateString, IsEmail, Min, Max, MaxLength, ValidateNested, IsIn, IsObject } from 'class-validator';
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
  @IsOptional() @IsBoolean() allowDuplicateRegistrations?: boolean;
  @IsOptional() @IsString() confirmationMessage?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RegistrationFieldDto) fields: RegistrationFieldDto[];
  @IsOptional() @IsString() botId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  // Public event page + branding.
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() bannerUrl?: string;
  @IsOptional() @IsString() flierUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) venue?: string;
  // Optional ticket tiers to create alongside the event (atomic). When present they supersede the
  // single price above.
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateTicketTypeDto) ticketTypes?: CreateTicketTypeDto[];
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
  @IsOptional() @IsBoolean() allowDuplicateRegistrations?: boolean;
  @IsOptional() @IsString() confirmationMessage?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RegistrationFieldDto) fields?: RegistrationFieldDto[];
  @IsOptional() @IsString() botId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() bannerUrl?: string;
  @IsOptional() @IsString() flierUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) venue?: string;
}

export class UpdateRegistrationEntryDto {
  @IsIn(['CONFIRMED', 'CANCELLED']) status: 'CONFIRMED' | 'CANCELLED';
}

export class CheckInDto {
  @IsString() @MaxLength(200) code: string;
  // When set, the scanner is locked to this event — tickets for other events are rejected.
  @IsOptional() @IsString() productId?: string;
}

// ── Ticket tiers ────────────────────────────────────────────────────────────
export class CreateTicketTypeDto {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateTicketTypeDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Public event page: self-serve registration/purchase ─────────────────────
export class PublicRegisterDto {
  @IsOptional() @IsString() @MaxLength(120) customerName?: string;
  @IsEmail() customerEmail: string;
  @IsOptional() @IsString() ticketTypeId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) quantity?: number;
  @IsOptional() @IsObject() fields?: Record<string, string>;
}

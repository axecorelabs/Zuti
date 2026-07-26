import { IsString, IsOptional, IsBoolean, IsEmail, IsArray, IsIn, MaxLength } from 'class-validator';

const LIFECYCLES = ['LEAD', 'ENGAGED', 'CUSTOMER'] as const;

export class UpdateCustomerDto {
  @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @IsOptional() @IsEmail() primaryEmail?: string;
  @IsOptional() @IsString() @MaxLength(40) primaryPhone?: string;
  @IsOptional() @IsIn(LIFECYCLES) lifecycleStage?: (typeof LIFECYCLES)[number];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsBoolean() emailOptOut?: boolean;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
}

export class MergeCustomerDto {
  // The duplicate to fold into this customer (the survivor is the :id in the route).
  @IsString() absorbedId: string;
}

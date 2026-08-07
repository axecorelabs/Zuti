import { IsBoolean, IsOptional, IsInt } from 'class-validator';

export class SetEventFeaturedDto {
  @IsBoolean()
  declare isFeatured: boolean;

  @IsOptional()
  @IsInt()
  featuredOrder?: number;
}

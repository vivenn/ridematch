import { IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RequestRideDto {
  @IsString()
  @IsNotEmpty()
  riderName: string;

  @IsString()
  @IsNotEmpty()
  riderPhone: string;

  @IsLatitude()
  pickupLat: number;

  @IsLongitude()
  pickupLng: number;

  @IsOptional()
  @IsLatitude()
  dropLat?: number;

  @IsOptional()
  @IsLongitude()
  dropLng?: number;
}

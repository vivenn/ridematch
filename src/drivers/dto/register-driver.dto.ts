import { IsNotEmpty, IsString } from 'class-validator';

export class RegisterDriverDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  vehicleNo: string;
}

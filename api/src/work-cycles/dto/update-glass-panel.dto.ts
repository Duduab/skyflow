import { IsIn, IsString } from 'class-validator';

export class UpdateGlassPanelDto {
  @IsString()
  code!: string;

  @IsIn(['WINDOW', 'FIXED'])
  kind!: 'WINDOW' | 'FIXED';
}

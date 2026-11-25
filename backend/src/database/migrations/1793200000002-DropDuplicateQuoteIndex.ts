import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `idx_player_quotes_user_player_date` (019) cubre las mismas columnas que
 * `idx_player_quotes_user_player_calc_desc` (031, FR-014): mantener los dos solo
 * agrega costo de escritura y hacía que el planificador ignorara el nuevo.
 */
export class DropDuplicateQuoteIndex1793200000002 implements MigrationInterface {
  name = 'DropDuplicateQuoteIndex1793200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_player_quotes_user_player_date";`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_player_quotes_user_player_date"
        ON "player_quotes" ("user_id", "player_id", "calculated_at");
    `);
  }
}

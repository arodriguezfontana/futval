import { League } from './enums/league';
import { Position } from './enums/position';
import { Player } from './player';

describe('Player.toSnapshot / Player.restore', () => {
  const full = Player.restore({
    id: 'p-1',
    name: 'Bukayo Saka',
    league: League.PREMIER_LEAGUE,
    team: 'Arsenal FC',
    position: Position.FW,
    matchesPlayed: 30,
    passesCompleted: 40.5,
    shots: 3.2,
    interceptions: 0.8,
    rating: 7.8,
    goals: 14,
    assists: 9,
    keyPasses: 55,
    dribbles: 60,
    totalTackles: 20,
    yellowCards: 3,
    redCards: 0,
  });

  it('el snapshot usa los nombres públicos de los campos (sin guiones bajos)', () => {
    const snapshot = full.toSnapshot();

    expect(Object.keys(snapshot).every((key) => !key.startsWith('_'))).toBe(true);
    expect(snapshot).toMatchObject({ id: 'p-1', name: 'Bukayo Saka', team: 'Arsenal FC', rating: 7.8, redCards: 0 });
  });

  it('ida y vuelta por JSON (lo que hace el cache) conserva todos los datos y los getters', () => {
    const rebuilt = Player.restore(JSON.parse(JSON.stringify(full.toSnapshot())));

    expect(rebuilt.name).toBe('Bukayo Saka');
    expect(rebuilt.toSnapshot()).toEqual(full.toSnapshot());
  });

  it('cubre todas las propiedades de la clase: si se agrega un campo y no entra al snapshot, falla', () => {
    const publicProps = Object.getOwnPropertyNames(Player.prototype).filter(
      (name) => name !== 'constructor' && name !== 'toSnapshot' && Object.getOwnPropertyDescriptor(Player.prototype, name)?.get,
    );

    expect(Object.keys(full.toSnapshot()).sort()).toEqual([...publicProps].sort());
  });

  it('las métricas ausentes quedan en null', () => {
    const minimal = Player.restore({
      id: 'p-2',
      name: 'Sin métricas',
      league: League.LA_LIGA,
      team: 'Real Madrid',
      position: Position.MF,
      passesCompleted: null,
      shots: null,
      interceptions: null,
      rating: null,
    });

    expect(minimal.toSnapshot()).toMatchObject({ matchesPlayed: null, goals: null, redCards: null, rating: null });
  });
});

import { config } from './config';
import { log } from './log';
import { Room } from './Room';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private timers = new Map<string, NodeJS.Timeout>();

  getOrCreate(id: string): Room {
    this.cancelCleanup(id);
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id);
      room.onEmpty = () => this.scheduleCleanup(id);
      this.rooms.set(id, room);
      log.info(`room ${id} created`);
      // A room nobody ever joins (e.g. failed handshake) must not live forever.
      this.scheduleCleanup(id);
    }
    return room;
  }

  stats(): { rooms: number; users: number } {
    let users = 0;
    for (const room of this.rooms.values()) users += room.members.size;
    return { rooms: this.rooms.size, users };
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.rooms.clear();
  }

  private scheduleCleanup(id: string): void {
    this.cancelCleanup(id);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      const room = this.rooms.get(id);
      if (room?.isEmpty) {
        this.rooms.delete(id);
        log.info(`room ${id} removed (idle)`);
      }
    }, config.roomIdleTtlMs);
    timer.unref();
    this.timers.set(id, timer);
  }

  private cancelCleanup(id: string): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }
}

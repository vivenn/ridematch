import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface RideOfferPayload {
  rideId: string;
  batchNumber: number;
  riderName: string;
  pickup: { lat: number; lng: number };
  drop?: { lat: number; lng: number } | null;
  expiresInMs: number;
}

export interface RideStatusPayload {
  rideId: string;
  status: string;
  driverId?: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  handleConnection(client: Socket) {
    const driverId = client.handshake.query.driverId as string | undefined;
    const rideId = client.handshake.query.rideId as string | undefined;

    if (driverId) {
      void client.join(`driver:${driverId}`);
      this.logger.log(`driver ${driverId} connected (${client.id})`);
    }
    if (rideId) {
      void client.join(`rider:${rideId}`);
      this.logger.log(`rider watching ride ${rideId} connected (${client.id})`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`client disconnected (${client.id})`);
  }

  @SubscribeMessage('ping')
  handlePing() {
    return { event: 'pong', data: Date.now() };
  }

  notifyDriversOfOffer(driverIds: string[], payload: RideOfferPayload) {
    for (const driverId of driverIds) {
      this.server.to(`driver:${driverId}`).emit('ride:offer', payload);
    }
  }

  notifyRideStatus(rideId: string, payload: RideStatusPayload) {
    this.server.to(`rider:${rideId}`).emit('ride:status', payload);
  }

  notifyDriverOfferClosed(driverId: string, rideId: string) {
    this.server.to(`driver:${driverId}`).emit('ride:offer:closed', { rideId });
  }
}

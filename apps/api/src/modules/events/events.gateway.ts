import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
  path: '/ws',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() orgId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`org:${orgId}`);
    this.logger.log(`Client ${client.id} joined org:${orgId}`);
  }

  @SubscribeMessage('leave')
  handleLeave(
    @MessageBody() orgId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`org:${orgId}`);
  }

  /**
   * Emit a new message event to all clients in the org room.
   * Called by TelegramProcessor and ConversationsService.
   */
  emitNewMessage(
    organizationId: string,
    payload: {
      conversationId: string;
      message: { id: string; role: string; content: string; createdAt: Date };
      customerName?: string | null;
    },
  ) {
    this.server.to(`org:${organizationId}`).emit('message:new', payload);
  }

  /**
   * Emit a conversation update (status/mode change) to the org room.
   */
  emitConversationUpdate(
    organizationId: string,
    payload: { conversationId: string; status?: string; mode?: string },
  ) {
    this.server.to(`org:${organizationId}`).emit('conversation:update', payload);
  }
}

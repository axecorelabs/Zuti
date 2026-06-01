import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

type SocketUser = { id: string; email?: string };

const isProduction = process.env.NODE_ENV === 'production';

const configuredWsOrigins = (process.env.WS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedWsOrigins = new Set<string>([
  'https://zuti.bords.app',
  ...(isProduction ? ['https://zuti-admin.vercel.app'] : ['http://localhost:3000']),
  ...configuredWsOrigins,
]);

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedWsOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Not allowed by websocket CORS'));
    },
    credentials: true,
  },
  path: '/ws',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwt.verify<{ sub: string; email?: string }>(token);
      client.data.user = { id: payload.sub, email: payload.email } satisfies SocketUser;
    } catch {
      client.disconnect(true);
      return;
    }

    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @MessageBody() orgId: string,
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data.user as SocketUser | undefined;
    if (!user?.id || typeof orgId !== 'string' || !orgId.trim()) {
      throw new WsException('Unauthorized');
    }

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
      select: { id: true },
    });
    if (!member) {
      throw new WsException('Forbidden');
    }

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
   * Emit a new conversation to the org room (e.g. resolved customer reopens).
   */
  emitNewConversation(organizationId: string, conversation: Record<string, any>) {
    this.server.to(`org:${organizationId}`).emit('conversation:new', conversation);
  }

  /**
   * Emit a conversation update (status/mode change) to the org room.
   */
  emitConversationUpdate(
    organizationId: string,
    payload: { conversationId: string; status?: string; mode?: string; assignedAgentId?: string | null; metadata?: Record<string, unknown> },
  ) {
    this.server.to(`org:${organizationId}`).emit('conversation:update', payload);
  }

  /**
   * Emit a team chat message to the org room.
   */
  emitTeamChatMessage(
    organizationId: string,
    payload: {
      id: string;
      organizationId: string;
      content: string;
      metadata: unknown;
      createdAt: Date;
      sender: { id: string; name: string | null; email: string };
    },
  ) {
    this.server.to(`org:${organizationId}`).emit('team:message:new', payload);
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }

    return null;
  }
}

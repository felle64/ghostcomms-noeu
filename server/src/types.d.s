import 'fastify'

declare module 'fastify' {
  interface FastifyReply {
    jwtSign(payload: any, options?: any): Promise<string>
  }
  interface FastifyRequest {
    jwtVerify(): Promise<any>
    user?: any
  }
  interface FastifyInstance {
    jwt: { verify(token: string): any }
  }
}

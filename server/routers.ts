import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { archiveLimits, buildArchive, getArchiveJobStatus, inspectGallery, prepareArchive } from "./archiveService";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  archive: router({
    inspect: publicProcedure.input(z.object({ url: z.string().min(1).max(2048) })).mutation(({ input }) => inspectGallery(input.url)),
    prepare: publicProcedure.input(z.object({
      sourceUrl: z.string().url().max(2048),
      images: z.array(z.object({
        id: z.string().regex(/^\d{4,24}$/),
        detailUrl: z.string().url(),
        previewUrl: z.string().url().optional(),
        originalUrl: z.string().url().optional(),
      })).min(1).max(archiveLimits.maxImages),
    })).mutation(({ input }) => prepareArchive(input.sourceUrl, input.images)),
    build: publicProcedure.input(z.object({ jobId: z.string().uuid() })).mutation(({ input }) => buildArchive(input.jobId)),
    status: publicProcedure.input(z.object({ jobId: z.string().uuid() })).query(({ input }) => getArchiveJobStatus(input.jobId)),
  }),
});

export type AppRouter = typeof appRouter;

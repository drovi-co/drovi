import { randomUUID } from "node:crypto";
import { db } from "@memorystack/db";
import { fileUpload } from "@memorystack/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

export const uploadsRouter = router({
  /**
   * Get a presigned URL for uploading a file
   */
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1),
        size: z
          .number()
          .positive()
          .max(100 * 1024 * 1024), // Max 100MB
        category: z
          .enum(["general", "avatar", "document", "image"])
          .default("general"),
      })
    )
    .mutation(({ ctx, input }) => {
      const { filename, contentType, category } = input;
      const userId = ctx.session.user.id;

      // Generate a unique file key
      const ext = filename.split(".").pop() || "";
      const fileId = randomUUID();
      const key = `uploads/${userId}/${category}/${fileId}.${ext}`;

      // Return the key and a placeholder URL
      // In a real implementation, you'd generate a presigned URL here
      return {
        fileId,
        key,
        uploadUrl: `/api/v1/uploads/${fileId}`,
        fields: {
          "Content-Type": contentType,
        },
      };
    }),

  /**
   * Confirm file upload completion
   */
  confirmUpload: protectedProcedure
    .input(
      z.object({
        fileId: z.string().uuid(),
        key: z.string().min(1),
        filename: z.string().min(1).max(255),
        mimeType: z.string().min(1),
        size: z.number().positive(),
        category: z
          .enum(["general", "avatar", "document", "image"])
          .default("general"),
        isPublic: z.boolean().default(false),
        metadata: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const {
        fileId,
        key,
        filename,
        mimeType,
        size,
        category,
        isPublic,
        metadata,
      } = input;
      const userId = ctx.session.user.id;

      // Create the file record
      await db.insert(fileUpload).values({
        id: fileId,
        userId,
        key,
        filename,
        mimeType,
        size: size.toString(),
        category,
        isPublic,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });

      return {
        id: fileId,
        key,
        filename,
        mimeType,
        size,
      };
    }),

  /**
   * List user's files
   */
  list: protectedProcedure
    .input(
      z.object({
        category: z.enum(["general", "avatar", "document", "image"]).optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { category, limit } = input;

      const conditions = [eq(fileUpload.userId, userId)];
      if (category) {
        conditions.push(eq(fileUpload.category, category));
      }

      const files = await db.query.fileUpload.findMany({
        where: and(...conditions),
        orderBy: [desc(fileUpload.createdAt)],
        limit: limit + 1,
      });

      let nextCursor: string | undefined;
      if (files.length > limit) {
        const nextItem = files.pop();
        nextCursor = nextItem?.id;
      }

      return {
        files: files.map((file) => ({
          id: file.id,
          key: file.key,
          filename: file.filename,
          mimeType: file.mimeType,
          size: Number.parseInt(file.size, 10),
          category: file.category,
          isPublic: file.isPublic,
          metadata: file.metadata ? JSON.parse(file.metadata) : null,
          createdAt: file.createdAt,
        })),
        nextCursor,
      };
    }),

  /**
   * Get a single file
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const file = await db.query.fileUpload.findFirst({
        where: and(eq(fileUpload.id, input.id), eq(fileUpload.userId, userId)),
      });

      if (!file) {
        throw new Error("File not found");
      }

      return {
        id: file.id,
        key: file.key,
        filename: file.filename,
        mimeType: file.mimeType,
        size: Number.parseInt(file.size, 10),
        category: file.category,
        isPublic: file.isPublic,
        metadata: file.metadata ? JSON.parse(file.metadata) : null,
        createdAt: file.createdAt,
      };
    }),

  /**
   * Delete a file
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // First check if the file exists and belongs to the user
      const file = await db.query.fileUpload.findFirst({
        where: and(eq(fileUpload.id, input.id), eq(fileUpload.userId, userId)),
      });

      if (!file) {
        throw new Error("File not found");
      }

      // Delete from database
      await db.delete(fileUpload).where(eq(fileUpload.id, input.id));

      // In a real implementation, you'd also delete from S3/R2 here
      // await deleteFile(file.key);

      return { success: true };
    }),

  /**
   * Update file metadata
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        filename: z.string().min(1).max(255).optional(),
        isPublic: z.boolean().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id, ...updates } = input;

      // First check if the file exists and belongs to the user
      const file = await db.query.fileUpload.findFirst({
        where: and(eq(fileUpload.id, id), eq(fileUpload.userId, userId)),
      });

      if (!file) {
        throw new Error("File not found");
      }

      const updateData: Record<string, unknown> = {};
      if (updates.filename !== undefined) {
        updateData.filename = updates.filename;
      }
      if (updates.isPublic !== undefined) {
        updateData.isPublic = updates.isPublic;
      }
      if (updates.metadata !== undefined) {
        updateData.metadata = JSON.stringify(updates.metadata);
      }

      if (Object.keys(updateData).length > 0) {
        await db
          .update(fileUpload)
          .set(updateData)
          .where(eq(fileUpload.id, id));
      }

      return { success: true };
    }),
});

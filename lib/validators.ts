// lib/validators.ts
import { z } from 'zod';

export const CategoryEnum = z.enum([
  'TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM',
]);

export const OrderItemSchema = z.object({
  category: CategoryEnum,
  number: z.string().regex(/^\d+$/), // ตัวเลขล้วน
  price: z.number().nonnegative(),
  type: z.enum(['MAIN', 'TOD3']),
});

export const OrderPayloadSchema = z.object({
  items: z.array(OrderItemSchema),
  convertTodToTop: z.boolean().optional(),
});

export type OrderItemInput = z.infer<typeof OrderItemSchema>;
export type OrderPayload = z.infer<typeof OrderPayloadSchema>;
export type Category = z.infer<typeof CategoryEnum>;

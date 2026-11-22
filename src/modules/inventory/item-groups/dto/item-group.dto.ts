import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { bigintIdSchema, optionalNullableBigintIdSchema } from '@/common/zod/common.schemas';
import { CATEGORY_CODE_PATTERN, ITEM_GROUP_MATERIAL_STAGES } from '../item-groups.constants';

/** RM / SF / FF; '' / null = not a stage category. */
const materialStageSchema = z.preprocess((v) => (v === '' ? null : v), z.enum(ITEM_GROUP_MATERIAL_STAGES).nullable().optional());

/** BRG, PLY, ASSY — trimmed + uppercased; '' / null = no code. */
const categoryCodeSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() ? v.trim().toUpperCase() : null) : v),
  z.string().regex(CATEGORY_CODE_PATTERN, 'Use 2 to 4 letters A-Z').nullable().optional(),
);

const descriptionSchema = z.preprocess(
  (v) => (v === '' ? null : v),
  z.string().trim().max(255).nullable().optional(),
);

/** storeCategoryId may be omitted for a child (it inherits the parent's store). */
export const CreateItemGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    storeCategoryId: bigintIdSchema.optional(),
    parentId: optionalNullableBigintIdSchema,
    categoryCode: categoryCodeSchema,
    description: descriptionSchema,
    sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
    isActive: z.boolean().optional().default(true),
    /** Made-part stage: items of an RM category can get linked SF / FF parts */
    materialStage: materialStageSchema,
  })
  .refine((v) => Boolean(v.storeCategoryId || v.parentId), {
    message: 'storeCategoryId is required for a top-level group',
    path: ['storeCategoryId'],
  });

/** The store of a group cannot change; parentId null moves the group to the top level. */
export const UpdateItemGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  parentId: optionalNullableBigintIdSchema,
  /** Locked once a part number was generated with it */
  categoryCode: categoryCodeSchema,
  description: descriptionSchema,
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  materialStage: materialStageSchema,
});

export const ItemGroupListQuerySchema = z.object({
  storeCategoryId: bigintIdSchema.optional(),
  includeInactive: z
    .preprocess((v) => v === 'true' || v === true, z.boolean())
    .optional()
    .default(false),
});

export class CreateItemGroupDto extends createZodDto(CreateItemGroupSchema) {}
export class UpdateItemGroupDto extends createZodDto(UpdateItemGroupSchema) {}
export class ItemGroupListQueryDto extends createZodDto(ItemGroupListQuerySchema) {}

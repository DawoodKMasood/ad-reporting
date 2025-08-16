import vine from '@vinejs/vine'

/**
 * Validator to validate the payload when creating
 * a new custom report
 */
export const createCustomReportValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(3).maxLength(255),
    description: vine.string().optional(),
    connectedAccountId: vine.number().positive(),
    platform: vine.enum(['google_ads', 'meta_ads', 'tiktok_ads']).optional(),
    filters: vine.any().optional(),
    metrics: vine.array(vine.string()).optional(),
    dimensions: vine.array(vine.string()).optional(),
    dateRangeType: vine.enum(['last_7_days', 'last_30_days', 'last_90_days', 'custom']).optional(),
    startDate: vine.date().optional(),
    endDate: vine.date().optional(),
    isScheduled: vine.boolean().optional(),
    scheduleFrequency: vine.enum(['daily', 'weekly', 'monthly']).optional(),
    widgetLayout: vine.array(vine.any()).optional(),
    ajax: vine.boolean().optional()
  })
)

/**
 * Validator to validate the payload when updating
 * an existing custom report
 */
export const updateCustomReportValidator = vine.compile(
  vine.object({
    name: vine.string().minLength(3).maxLength(255).optional(),
    description: vine.string().optional(),
    connectedAccountId: vine.number().positive().optional(),
    filters: vine.any().optional(),
    metrics: vine.array(vine.string()).optional(),
    dimensions: vine.array(vine.string()).optional(),
    dateRangeType: vine.enum(['last_7_days', 'last_30_days', 'last_90_days', 'custom']).optional(),
    startDate: vine.date().optional(),
    endDate: vine.date().optional(),
    isScheduled: vine.boolean().optional(),
    scheduleFrequency: vine.enum(['daily', 'weekly', 'monthly']).optional(),
    widgetLayout: vine.array(vine.any()).optional(),
    ajax: vine.boolean().optional()
  })
)

/**
 * Validator to validate the payload when saving widget layout
 */
export const saveLayoutValidator = vine.compile(
  vine.object({
    reportId: vine.number().positive().optional(),
    connectedAccountId: vine.number().positive().optional(),
    widgetLayout: vine.array(vine.any()).minLength(1),
    name: vine.string().minLength(3).maxLength(255).optional(),
    description: vine.string().optional(),
    platform: vine.enum(['google_ads', 'meta_ads', 'tiktok_ads']).optional()
  })
)

/**
 * Validator to validate the payload when previewing a report
 */
export const previewReportValidator = vine.compile(
  vine.object({
    widgetLayout: vine.array(vine.any()).minLength(1),
    reportId: vine.number().positive().optional(),
    connectedAccountId: vine.number().positive().optional()
  })
)
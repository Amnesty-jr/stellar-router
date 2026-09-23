export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export const TIER_ORDER: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};

export const DEFAULT_UPGRADE_URL = 'https://app.craft.com/settings/billing/upgrade';

export interface StructuredLogger {
  error: (obj: Record<string, any> | string, msg?: string) => void;
  warn?: (obj: Record<string, any> | string, msg?: string) => void;
  info?: (obj: Record<string, any> | string, msg?: string) => void;
}

export interface SupabaseClientLike {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: any) => {
        single: () => Promise<{ data: any; error: any }>;
      };
    };
  };
}

export interface MiddlewareRequest {
  user?: {
    id: string;
    email?: string;
    tier?: SubscriptionTier;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface MiddlewareResponse {
  status: (code: number) => MiddlewareResponse;
  json: (body: any) => MiddlewareResponse;
  [key: string]: any;
}

export type NextFunction = (err?: any) => void;

export interface TierEnforcementOptions {
  supabaseClient?: SupabaseClientLike;
  logger?: StructuredLogger;
  upgradeUrl?: string;
}

const defaultLogger: StructuredLogger = {
  error: (obj, msg) => console.error(msg || obj, obj),
};

export function requireTier(
  requiredTier: SubscriptionTier,
  options: TierEnforcementOptions = {}
) {
  const upgradeUrl = options.upgradeUrl || process.env.UPGRADE_URL || DEFAULT_UPGRADE_URL;
  const logger = options.logger || defaultLogger;

  return async (req: MiddlewareRequest, res: MiddlewareResponse, next: NextFunction) => {
    // Unauthenticated request check
    if (!req || !req.user || !req.user.id) {
      return res.status(401).json({
        error: 'Unauthenticated request',
        code: 'UNAUTHENTICATED',
      });
    }

    let userTier: SubscriptionTier = 'free'; // Fail closed default

    try {
      const supabase = options.supabaseClient;
      if (!supabase) {
        throw new Error('Supabase client not configured');
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', req.user.id)
        .single();

      if (error) {
        logger.error(
          {
            error,
            userId: req.user.id,
            requiredTier,
            fallbackTier: 'free',
          },
          'Database error fetching user subscription tier from profiles; failing closed to free'
        );
        userTier = 'free';
      } else if (data && data.tier && data.tier in TIER_ORDER) {
        userTier = data.tier as SubscriptionTier;
      } else {
        userTier = 'free';
      }
    } catch (err: any) {
      logger.error(
        {
          error: err,
          userId: req.user.id,
          requiredTier,
          fallbackTier: 'free',
        },
        'Exception encountered fetching user subscription tier from profiles; failing closed to free'
      );
      userTier = 'free';
    }

    const userRank = TIER_ORDER[userTier] ?? 0;
    const requiredRank = TIER_ORDER[requiredTier] ?? 0;

    if (userRank < requiredRank) {
      return res.status(402).json({
        error: `Subscription tier '${requiredTier}' required. Current tier: '${userTier}'.`,
        code: 'INSUFFICIENT_SUBSCRIPTION_TIER',
        requiredTier,
        currentTier: userTier,
        upgradeUrl,
      });
    }

    return next();
  };
}

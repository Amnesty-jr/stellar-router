import {
  requireTier,
  TIER_ORDER,
  SubscriptionTier,
  DEFAULT_UPGRADE_URL,
  StructuredLogger,
  SupabaseClientLike,
} from './tier-enforcement.middleware';

describe('tier-enforcement.middleware', () => {
  let mockRes: any;
  let mockNext: jest.Mock;
  let mockLogger: StructuredLogger;

  beforeEach(() => {
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    };
  });

  const createMockSupabase = (tierResult: SubscriptionTier | null, errorResult: any = null): SupabaseClientLike => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: tierResult ? { tier: tierResult } : null,
            error: errorResult,
          }),
        }),
      }),
    }),
  });

  describe('Unauthenticated Requests', () => {
    it('should return 401 for unauthenticated request (missing req.user)', async () => {
      const middleware = requireTier('free', { logger: mockLogger });
      const req = {};

      await middleware(req as any, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthenticated request',
          code: 'UNAUTHENTICATED',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when req.user has no id', async () => {
      const middleware = requireTier('free', { logger: mockLogger });
      const req = { user: {} };

      await middleware(req as any, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('TIER_ORDER Comparison Matrix', () => {
    const tiers: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

    tiers.forEach((callerTier) => {
      tiers.forEach((requiredTier) => {
        const callerRank = TIER_ORDER[callerTier];
        const requiredRank = TIER_ORDER[requiredTier];
        const shouldPass = callerRank >= requiredRank;

        it(`caller tier '${callerTier}' vs required tier '${requiredTier}' -> should ${shouldPass ? 'pass' : 'fail with 402'}`, async () => {
          const supabaseMock = createMockSupabase(callerTier);
          const middleware = requireTier(requiredTier, {
            supabaseClient: supabaseMock,
            logger: mockLogger,
          });

          const req = { user: { id: 'usr-123' } };

          await middleware(req as any, mockRes, mockNext);

          if (shouldPass) {
            expect(mockNext).toHaveBeenCalledTimes(1);
            expect(mockRes.status).not.toHaveBeenCalled();
          } else {
            expect(mockNext).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(402);
            expect(mockRes.json).toHaveBeenCalledWith(
              expect.objectContaining({
                error: expect.stringContaining(`Subscription tier '${requiredTier}' required`),
                currentTier: callerTier,
                requiredTier,
                upgradeUrl: DEFAULT_UPGRADE_URL,
              })
            );
          }
        });
      });
    });
  });

  describe('Database Error Fail-Closed Path', () => {
    it('should log via structured logger and fail closed to free tier when Supabase lookup returns error (requiring pro)', async () => {
      const dbError = { message: 'Database query timed out', code: 'PGRST301' };
      const supabaseMock = createMockSupabase(null, dbError);

      const middleware = requireTier('pro', {
        supabaseClient: supabaseMock,
        logger: mockLogger,
      });

      const req = { user: { id: 'usr-err-1' } };

      await middleware(req as any, mockRes, mockNext);

      // Assert structured logger error call
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: dbError,
          userId: 'usr-err-1',
          requiredTier: 'pro',
          fallbackTier: 'free',
        }),
        expect.stringContaining('Database error fetching user subscription tier')
      );

      // Assert failed closed to free (402 returned for required pro tier)
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          currentTier: 'free',
          requiredTier: 'pro',
          upgradeUrl: DEFAULT_UPGRADE_URL,
        })
      );
    });

    it('should log via structured logger and fail closed to free tier when Supabase lookup returns error (requiring free)', async () => {
      const dbError = { message: 'Connection reset', code: '57P01' };
      const supabaseMock = createMockSupabase(null, dbError);

      const middleware = requireTier('free', {
        supabaseClient: supabaseMock,
        logger: mockLogger,
      });

      const req = { user: { id: 'usr-err-2' } };

      await middleware(req as any, mockRes, mockNext);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      // Fails closed to free; required tier is free so next() is invoked
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should log via structured logger and fail closed to free tier when Supabase lookup throws exception', async () => {
      const supabaseMock: SupabaseClientLike = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockRejectedValue(new Error('Network offline')),
            }),
          }),
        }),
      };

      const middleware = requireTier('pro', {
        supabaseClient: supabaseMock,
        logger: mockLogger,
      });

      const req = { user: { id: 'usr-throw-1' } };

      await middleware(req as any, mockRes, mockNext);

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          userId: 'usr-throw-1',
          fallbackTier: 'free',
        }),
        expect.stringContaining('Exception encountered fetching user subscription tier')
      );
      expect(mockRes.status).toHaveBeenCalledWith(402);
    });
  });

  describe('Upgrade URL Documented Value', () => {
    it('should include custom configured upgradeUrl in 402 response', async () => {
      const customUpgradeUrl = 'https://custom.craft.com/upgrade-plan';
      const supabaseMock = createMockSupabase('free');

      const middleware = requireTier('enterprise', {
        supabaseClient: supabaseMock,
        logger: mockLogger,
        upgradeUrl: customUpgradeUrl,
      });

      const req = { user: { id: 'usr-custom-url' } };

      await middleware(req as any, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(402);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          upgradeUrl: customUpgradeUrl,
        })
      );
    });
  });
});

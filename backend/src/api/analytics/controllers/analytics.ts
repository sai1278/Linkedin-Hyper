/**
 * Analytics Controller
 * 
 * Implements the Adapter Pattern for analytics data:
 * - Mock Mode (MOCK_ANALYTICS=true): Returns static mock data for development
 * - Real Mode (MOCK_ANALYTICS=false): Fetches real data from GA4 Data API
 */

import type { Core } from '@strapi/strapi';
import type { AnalyticsDashboardData, ChartDataPoint } from '../types';

/**
 * Generate mock chart data for the last 30 days
 */
function generateMockChartData(): ChartDataPoint[] {
    const chartData: ChartDataPoint[] = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);

        const label = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });

        // Generate realistic-looking random data
        const baseViews = 1000 + Math.floor(Math.random() * 500);
        const baseUsers = 30 + Math.floor(Math.random() * 30);

        // Add slight weekly patterns (weekends have less traffic)
        const dayOfWeek = date.getDay();
        const weekendMultiplier = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.7 : 1;

        chartData.push({
            label,
            views: Math.floor(baseViews * weekendMultiplier),
            users: Math.floor(baseUsers * weekendMultiplier),
        });
    }

    return chartData;
}

/**
 * Generate complete mock dashboard data
 */
function getMockData(): AnalyticsDashboardData {
    const chartData = generateMockChartData();

    const totalViews = chartData.reduce((sum, day) => sum + day.views, 0);
    const activeUsers = chartData.reduce((sum, day) => sum + day.users, 0);

    return {
        totalViews,
        activeUsers,
        chartData,
        period: 'Last 30 days',
        generatedAt: new Date().toISOString(),
    };
}

export default {
    /**
     * GET /api/analytics/dashboard
     * 
     * Returns analytics dashboard data in a consistent format.
     * Switches between mock and real data based on MOCK_ANALYTICS env variable.
     */
    async getDashboardData(ctx) {
        // Default to mock mode unless explicitly set to 'false'
        const mockEnv = process.env.MOCK_ANALYTICS;
        const isMockMode = mockEnv !== 'false';

        try {
            if (isMockMode) {
                strapi.log.info('Analytics: Returning mock data (MOCK_ANALYTICS != false)');
                ctx.body = getMockData();
                return;
            }

            // Real mode: fetch from GA4 Data API
            strapi.log.info('Analytics: Fetching real data from GA4 API');
            const analyticsService = strapi.service('api::analytics.analytics');
            const realData = await analyticsService.fetchRealData();

            ctx.body = realData;
        } catch (error: any) {
            strapi.log.error('Analytics Controller Error:', error.message);

            ctx.status = 500;
            ctx.body = {
                error: {
                    status: 500,
                    name: 'AnalyticsError',
                    message: 'Failed to fetch analytics data',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
                },
            };
        }
    },
};

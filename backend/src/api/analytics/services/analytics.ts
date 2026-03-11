/**
 * Analytics Service
 * 
 * Implements the Google Analytics 4 Data API integration
 * Fetches real analytics data and transforms it to match the mock data structure
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';
import type { AnalyticsDashboardData, ChartDataPoint } from '../types';

/**
 * Format a date string (YYYYMMDD) to readable format (Dec 01)
 */
function formatDateLabel(dateString: string): string {
    const year = dateString.slice(0, 4);
    const month = dateString.slice(4, 6);
    const day = dateString.slice(6, 8);
    const date = new Date(`${year}-${month}-${day}`);

    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

/**
 * Transform raw GA4 API response into clean dashboard data structure
 */
function transformGAResponse(response: any): AnalyticsDashboardData {
    let totalViews = 0;
    let totalUsers = 0;
    const chartData: ChartDataPoint[] = [];

    if (response?.rows) {
        for (const row of response.rows) {
            const dateValue = row.dimensionValues?.[0]?.value || '';
            const users = parseInt(row.metricValues?.[0]?.value || '0', 10);
            const views = parseInt(row.metricValues?.[1]?.value || '0', 10);

            totalUsers += users;
            totalViews += views;

            chartData.push({
                label: formatDateLabel(dateValue),
                views,
                users,
            });
        }
    }

    // Sort by date (the label format "Dec 01" needs custom sorting)
    // GA4 returns data sorted by date already, but we ensure it's correct
    chartData.sort((a, b) => {
        const dateA = new Date(a.label + ', 2025');
        const dateB = new Date(b.label + ', 2025');
        return dateA.getTime() - dateB.getTime();
    });

    return {
        totalViews,
        activeUsers: totalUsers,
        chartData,
        period: 'Last 30 days',
        generatedAt: new Date().toISOString(),
    };
}

export default {
    /**
     * Fetch real analytics data from Google Analytics 4 Data API
     * 
     * Requires environment variables:
     * - GA_PROPERTY_ID: The GA4 property ID (numeric)
     * - GA_CREDENTIALS: JSON string of service account credentials
     */
    async fetchRealData(): Promise<AnalyticsDashboardData> {
        const propertyId = process.env.GA_PROPERTY_ID;
        const credentialsJson = process.env.GA_CREDENTIALS;

        if (!propertyId) {
            throw new Error('GA_PROPERTY_ID environment variable is not set');
        }

        if (!credentialsJson) {
            throw new Error('GA_CREDENTIALS environment variable is not set');
        }

        let credentials;
        try {
            credentials = JSON.parse(credentialsJson);
        } catch (error) {
            throw new Error('GA_CREDENTIALS is not valid JSON');
        }

        // Initialize the Analytics Data API client
        const analyticsDataClient = new BetaAnalyticsDataClient({
            credentials,
        });

        try {
            // Run the report query
            const [response] = await analyticsDataClient.runReport({
                property: `properties/${propertyId}`,
                dateRanges: [
                    {
                        startDate: '30daysAgo',
                        endDate: 'today',
                    },
                ],
                dimensions: [
                    { name: 'date' },
                ],
                metrics: [
                    { name: 'activeUsers' },
                    { name: 'screenPageViews' },
                ],
                orderBys: [
                    {
                        dimension: { dimensionName: 'date' },
                        desc: false,
                    },
                ],
            });

            return transformGAResponse(response);
        } catch (error: any) {
            strapi.log.error('Failed to fetch GA4 data:', error.message);
            throw new Error(`Failed to fetch analytics data: ${error.message}`);
        }
    },
};

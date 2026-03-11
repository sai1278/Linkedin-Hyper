/**
 * TypeScript interfaces for Analytics Dashboard data
 * These types ensure consistent data structure between mock and real modes
 */

export interface ChartDataPoint {
    /** Date formatted as "Dec 01" */
    label: string;
    /** Page views count */
    views: number;
    /** Active users count */
    users: number;
}

export interface AnalyticsDashboardData {
    /** Total page views in the period */
    totalViews: number;
    /** Total active users in the period */
    activeUsers: number;
    /** Daily breakdown data for charts */
    chartData: ChartDataPoint[];
    /** Human-readable period description */
    period: string;
    /** ISO timestamp when data was generated */
    generatedAt: string;
}

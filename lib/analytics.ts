/**
 * Analytics Data Service - Frontend Example
 * 
 * Demonstrates how to consume the Strapi analytics API endpoint
 * from a React/Next.js frontend application.
 */

// Types matching the Strapi API response
export interface ChartDataPoint {
    label: string;
    views: number;
    users: number;
}

export interface AnalyticsDashboardData {
    totalViews: number;
    activeUsers: number;
    chartData: ChartDataPoint[];
    period: string;
    generatedAt: string;
}

export interface AnalyticsError {
    error: {
        status: number;
        name: string;
        message: string;
        details?: string;
    };
}

/**
 * Fetch analytics dashboard data from Strapi
 * 
 * @returns Analytics dashboard data or throws an error
 * 
 * @example
 * ```tsx
 * // In a React component
 * const [data, setData] = useState<AnalyticsDashboardData | null>(null);
 * 
 * useEffect(() => {
 *   fetchAnalyticsDashboard()
 *     .then(setData)
 *     .catch(console.error);
 * }, []);
 * ```
 */
export async function fetchAnalyticsDashboard(): Promise<AnalyticsDashboardData> {
    const strapiUrl = process.env.NEXT_PUBLIC_STRAPI_URL || 'http://localhost:1337';
    const endpoint = `${strapiUrl}/api/analytics/dashboard`;

    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            // Cache for 5 minutes in production
            next: { revalidate: 300 },
        });

        if (!response.ok) {
            const errorData: AnalyticsError = await response.json();
            throw new Error(errorData.error?.message || 'Failed to fetch analytics');
        }

        const data: AnalyticsDashboardData = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching analytics:', error);
        throw error;
    }
}

/**
 * React Hook example for fetching analytics data
 * 
 * @example
 * ```tsx
 * function AnalyticsDashboard() {
 *   const { data, loading, error } = useAnalytics();
 * 
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 * 
 *   return (
 *     <div>
 *       <h1>Dashboard</h1>
 *       <p>Total Views: {data?.totalViews.toLocaleString()}</p>
 *       <p>Active Users: {data?.activeUsers.toLocaleString()}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAnalyticsExample() {
    // This is a simplified example - in production, use SWR or React Query
    const exampleCode = `
import { useEffect, useState } from 'react';
import { fetchAnalyticsDashboard, AnalyticsDashboardData } from '@/lib/analytics';

export function useAnalytics() {
  const [data, setData] = useState<AnalyticsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchAnalyticsDashboard()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}
`;
    return exampleCode;
}

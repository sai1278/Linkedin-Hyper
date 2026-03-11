'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import type { SiteSettingsAttributes } from '@/lib/strapi';

interface GoogleTagManagerProps {
    settings: SiteSettingsAttributes | null;
}

/**
 * Google Tag Manager Component
 * Injects GTM scripts into the page when enabled in site settings
 */
export function GoogleTagManager({ settings }: GoogleTagManagerProps) {
    if (!settings?.gtmEnabled || !settings?.gtmId) {
        return null;
    }

    return (
        <>
            {/* Google Tag Manager - Script */}
            <Script
                id="gtm-script"
                strategy="afterInteractive"
                dangerouslySetInnerHTML={{
                    __html: `
                        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
                        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
                        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
                        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
                        })(window,document,'script','dataLayer','${settings.gtmId}');
                    `,
                }}
            />
        </>
    );
}

/**
 * Google Tag Manager NoScript Component
 * Renders the noscript iframe for users with JavaScript disabled
 */
export function GoogleTagManagerNoScript({ settings }: GoogleTagManagerProps) {
    if (!settings?.gtmEnabled || !settings?.gtmId) {
        return null;
    }

    return (
        <noscript>
            <iframe
                src={`https://www.googletagmanager.com/ns.html?id=${settings.gtmId}`}
                height="0"
                width="0"
                style={{ display: 'none', visibility: 'hidden' }}
            />
        </noscript>
    );
}

/**
 * Google Analytics Component
 * Injects GA4 scripts when enabled in site settings
 */
export function GoogleAnalytics({ settings }: GoogleTagManagerProps) {
    if (!settings?.gaEnabled || !settings?.googleAnalyticsId) {
        return null;
    }

    return (
        <>
            <Script
                src={`https://www.googletagmanager.com/gtag/js?id=${settings.googleAnalyticsId}`}
                strategy="afterInteractive"
            />
            <Script
                id="ga-script"
                strategy="afterInteractive"
                dangerouslySetInnerHTML={{
                    __html: `
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());
                        gtag('config', '${settings.googleAnalyticsId}');
                    `,
                }}
            />
        </>
    );
}

/**
 * Meta Pixel Component
 * Injects Meta/Facebook Pixel when enabled in site settings
 */
export function MetaPixel({ settings }: GoogleTagManagerProps) {
    if (!settings?.metaPixelEnabled || !settings?.metaPixelId) {
        return null;
    }

    return (
        <>
            <Script
                id="meta-pixel"
                strategy="afterInteractive"
                dangerouslySetInnerHTML={{
                    __html: `
                        !function(f,b,e,v,n,t,s)
                        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                        n.queue=[];t=b.createElement(e);t.async=!0;
                        t.src=v;s=b.getElementsByTagName(e)[0];
                        s.parentNode.insertBefore(t,s)}(window, document,'script',
                        'https://connect.facebook.net/en_US/fbevents.js');
                        fbq('init', '${settings.metaPixelId}');
                        fbq('track', 'PageView');
                    `,
                }}
            />
            <noscript>
                <img
                    height="1"
                    width="1"
                    style={{ display: 'none' }}
                    src={`https://www.facebook.com/tr?id=${settings.metaPixelId}&ev=PageView&noscript=1`}
                    alt=""
                />
            </noscript>
        </>
    );
}

/**
 * Custom Scripts Component
 * Injects custom head/body scripts from site settings
 */
export function CustomScripts({ settings, location }: GoogleTagManagerProps & { location: 'head' | 'body' }) {
    const scriptContent = location === 'head'
        ? settings?.customHeadScripts
        : settings?.customBodyScripts;

    if (!scriptContent) {
        return null;
    }

    return (
        <Script
            id={`custom-${location}-scripts`}
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html: scriptContent }}
        />
    );
}

/**
 * Combined Analytics Component
 * Wraps all analytics providers for easy inclusion in layout
 */
export function Analytics({ settings }: GoogleTagManagerProps) {
    return (
        <>
            <GoogleTagManager settings={settings} />
            <GoogleAnalytics settings={settings} />
            <MetaPixel settings={settings} />
            <CustomScripts settings={settings} location="head" />
        </>
    );
}

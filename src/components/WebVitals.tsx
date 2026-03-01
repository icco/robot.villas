"use client";

import { useReportWebVitals } from "next/web-vitals";

const ENDPOINT = "https://reportd.natwelch.com/analytics/robot-villas";

export function WebVitals() {
  useReportWebVitals((metric) => {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, body);
    } else {
      fetch(ENDPOINT, { body, method: "POST", keepalive: true });
    }
  });

  return null;
}

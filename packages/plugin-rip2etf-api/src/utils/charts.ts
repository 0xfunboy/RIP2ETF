import { createCanvas } from "@napi-rs/canvas";
import {
  Chart,
  type ChartConfiguration,
  type ChartDataset as ChartJSDataset,
  registerables
} from "chart.js";

Chart.register(...registerables);

const chartWidth =
  Number.parseInt(process.env.RIP2ETF_CHART_WIDTH ?? "", 10) > 0
    ? Number.parseInt(process.env.RIP2ETF_CHART_WIDTH ?? "", 10)
    : 900;

const chartHeight =
  Number.parseInt(process.env.RIP2ETF_CHART_HEIGHT ?? "", 10) > 0
    ? Number.parseInt(process.env.RIP2ETF_CHART_HEIGHT ?? "", 10)
    : 450;

const palette = [
  "#1f78b4",
  "#33a02c",
  "#e31a1c",
  "#ff7f00",
  "#6a3d9a",
  "#b15928",
  "#a6cee3",
  "#b2df8a"
];

export interface ChartDataset {
  label: string;
  data: Array<number | null>;
  borderColor?: string;
  backgroundColor?: string;
}

export type ChartConfig = ChartConfiguration<"line", Array<number | null>, string>;

export interface ChartResult {
  chartUrl: string;
  config: ChartConfig;
  mimeType: string;
  buffer: Buffer;
  fileName: string;
}

function buildLineChartConfig(
  labels: string[],
  datasets: ChartDataset[],
  title?: string
): ChartConfig {
  const styledDatasets: ChartJSDataset<"line", Array<number | null>>[] = datasets.map(
    (dataset, index) => {
      const color = dataset.borderColor ?? palette[index % palette.length];
      return {
        label: dataset.label,
        data: dataset.data,
        borderColor: color,
        backgroundColor: dataset.backgroundColor ?? color,
        pointRadius: 0,
        tension: 0.25,
        borderWidth: 2,
        spanGaps: true
      };
    }
  );

  return {
    type: "line",
    data: { labels, datasets: styledDatasets },
    options: {
      responsive: false,
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        title: { display: Boolean(title), text: title }
      },
      interaction: {
        intersect: false,
        mode: "nearest"
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 12 }
        },
        y: {
          ticks: {
            callback: (value: number | string) => {
              if (typeof value === "number" && Number.isFinite(value)) {
                return value.toFixed(1);
              }
              return value;
            }
          }
        }
      }
    }
  };
}

function bufferToDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function createLineChartImage(
  labels: string[],
  datasets: ChartDataset[],
  title?: string
): Promise<ChartResult> {
  const config = buildLineChartConfig(labels, datasets, title);
  const canvas = createCanvas(chartWidth, chartHeight);
  const ctx = canvas.getContext("2d");

  // solid background to avoid transparent PNGs on dark mode clients
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, chartWidth, chartHeight);

  const chart = new Chart(ctx as unknown as CanvasRenderingContext2D, config);
  chart.update();

  const buffer = canvas.toBuffer("image/png");
  chart.destroy();

  const mimeType = "image/png";
  return {
    chartUrl: bufferToDataUrl(buffer, mimeType),
    config,
    mimeType,
    buffer,
    fileName: `rip2etf-chart-${Date.now()}.png`
  };
}

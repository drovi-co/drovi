import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import type { ChartConfig } from "@memorystack/ui-core/chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@memorystack/ui-core/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@memorystack/ui-core/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@memorystack/ui-core/toggle-group";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

// Sample data for leads tracking
const chartData = [
  { date: "2024-04-01", leads: 222, conversions: 150 },
  { date: "2024-04-02", leads: 97, conversions: 180 },
  { date: "2024-04-03", leads: 167, conversions: 120 },
  { date: "2024-04-04", leads: 242, conversions: 260 },
  { date: "2024-04-05", leads: 373, conversions: 290 },
  { date: "2024-04-06", leads: 301, conversions: 340 },
  { date: "2024-04-07", leads: 245, conversions: 180 },
  { date: "2024-04-08", leads: 409, conversions: 320 },
  { date: "2024-04-09", leads: 59, conversions: 110 },
  { date: "2024-04-10", leads: 261, conversions: 190 },
  { date: "2024-04-11", leads: 327, conversions: 350 },
  { date: "2024-04-12", leads: 292, conversions: 210 },
  { date: "2024-04-13", leads: 342, conversions: 380 },
  { date: "2024-04-14", leads: 137, conversions: 220 },
  { date: "2024-04-15", leads: 120, conversions: 170 },
  { date: "2024-04-16", leads: 138, conversions: 190 },
  { date: "2024-04-17", leads: 446, conversions: 360 },
  { date: "2024-04-18", leads: 364, conversions: 410 },
  { date: "2024-04-19", leads: 243, conversions: 180 },
  { date: "2024-04-20", leads: 89, conversions: 150 },
  { date: "2024-04-21", leads: 137, conversions: 200 },
  { date: "2024-04-22", leads: 224, conversions: 170 },
  { date: "2024-04-23", leads: 138, conversions: 230 },
  { date: "2024-04-24", leads: 387, conversions: 290 },
  { date: "2024-04-25", leads: 215, conversions: 250 },
  { date: "2024-04-26", leads: 75, conversions: 130 },
  { date: "2024-04-27", leads: 383, conversions: 420 },
  { date: "2024-04-28", leads: 122, conversions: 180 },
  { date: "2024-04-29", leads: 315, conversions: 240 },
  { date: "2024-04-30", leads: 454, conversions: 380 },
  { date: "2024-05-01", leads: 165, conversions: 220 },
  { date: "2024-05-02", leads: 293, conversions: 310 },
  { date: "2024-05-03", leads: 247, conversions: 190 },
  { date: "2024-05-04", leads: 385, conversions: 420 },
  { date: "2024-05-05", leads: 481, conversions: 390 },
  { date: "2024-05-06", leads: 498, conversions: 520 },
  { date: "2024-05-07", leads: 388, conversions: 300 },
  { date: "2024-05-08", leads: 149, conversions: 210 },
  { date: "2024-05-09", leads: 227, conversions: 180 },
  { date: "2024-05-10", leads: 293, conversions: 330 },
  { date: "2024-05-11", leads: 335, conversions: 270 },
  { date: "2024-05-12", leads: 197, conversions: 240 },
  { date: "2024-05-13", leads: 197, conversions: 160 },
  { date: "2024-05-14", leads: 448, conversions: 490 },
  { date: "2024-05-15", leads: 473, conversions: 380 },
  { date: "2024-05-16", leads: 338, conversions: 400 },
  { date: "2024-05-17", leads: 499, conversions: 420 },
  { date: "2024-05-18", leads: 315, conversions: 350 },
  { date: "2024-05-19", leads: 235, conversions: 180 },
  { date: "2024-05-20", leads: 177, conversions: 230 },
  { date: "2024-05-21", leads: 82, conversions: 140 },
  { date: "2024-05-22", leads: 81, conversions: 120 },
  { date: "2024-05-23", leads: 252, conversions: 290 },
  { date: "2024-05-24", leads: 294, conversions: 220 },
  { date: "2024-05-25", leads: 201, conversions: 250 },
  { date: "2024-05-26", leads: 213, conversions: 170 },
  { date: "2024-05-27", leads: 420, conversions: 460 },
  { date: "2024-05-28", leads: 233, conversions: 190 },
  { date: "2024-05-29", leads: 78, conversions: 130 },
  { date: "2024-05-30", leads: 340, conversions: 280 },
  { date: "2024-05-31", leads: 178, conversions: 230 },
  { date: "2024-06-01", leads: 178, conversions: 200 },
  { date: "2024-06-02", leads: 470, conversions: 410 },
  { date: "2024-06-03", leads: 103, conversions: 160 },
  { date: "2024-06-04", leads: 439, conversions: 380 },
  { date: "2024-06-05", leads: 88, conversions: 140 },
  { date: "2024-06-06", leads: 294, conversions: 250 },
  { date: "2024-06-07", leads: 323, conversions: 370 },
  { date: "2024-06-08", leads: 385, conversions: 320 },
  { date: "2024-06-09", leads: 438, conversions: 480 },
  { date: "2024-06-10", leads: 155, conversions: 200 },
  { date: "2024-06-11", leads: 92, conversions: 150 },
  { date: "2024-06-12", leads: 492, conversions: 420 },
  { date: "2024-06-13", leads: 81, conversions: 130 },
  { date: "2024-06-14", leads: 426, conversions: 380 },
  { date: "2024-06-15", leads: 307, conversions: 350 },
  { date: "2024-06-16", leads: 371, conversions: 310 },
  { date: "2024-06-17", leads: 475, conversions: 520 },
  { date: "2024-06-18", leads: 107, conversions: 170 },
  { date: "2024-06-19", leads: 341, conversions: 290 },
  { date: "2024-06-20", leads: 408, conversions: 450 },
  { date: "2024-06-21", leads: 169, conversions: 210 },
  { date: "2024-06-22", leads: 317, conversions: 270 },
  { date: "2024-06-23", leads: 480, conversions: 530 },
  { date: "2024-06-24", leads: 132, conversions: 180 },
  { date: "2024-06-25", leads: 141, conversions: 190 },
  { date: "2024-06-26", leads: 434, conversions: 380 },
  { date: "2024-06-27", leads: 448, conversions: 490 },
  { date: "2024-06-28", leads: 149, conversions: 200 },
  { date: "2024-06-29", leads: 103, conversions: 160 },
  { date: "2024-06-30", leads: 446, conversions: 400 },
];

const chartConfig = {
  visitors: {
    label: "Visitors",
  },
  leads: {
    label: "Users",
    color: "var(--primary)",
  },
  conversions: {
    label: "Revenue",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export function ChartAreaInteractive() {
  const [timeRange, setTimeRange] = React.useState("90d");

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date);
    const referenceDate = new Date("2024-06-30");
    let daysToSubtract = 90;
    if (timeRange === "30d") {
      daysToSubtract = 30;
    } else if (timeRange === "7d") {
      daysToSubtract = 7;
    }
    const startDate = new Date(referenceDate);
    startDate.setDate(startDate.getDate() - daysToSubtract);
    return date >= startDate;
  });

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Growth Overview</CardTitle>
        <CardDescription>
          <span className="@[540px]/card:block hidden">
            User signups and revenue for the last 3 months
          </span>
          <span className="@[540px]/card:hidden">Last 3 months</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            className="*:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex hidden"
            onValueChange={setTimeRange}
            type="single"
            value={timeRange}
            variant="outline"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select onValueChange={setTimeRange} value={timeRange}>
            <SelectTrigger
              aria-label="Select a value"
              className="flex @[767px]/card:hidden w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem className="rounded-lg" value="90d">
                Last 3 months
              </SelectItem>
              <SelectItem className="rounded-lg" value="30d">
                Last 30 days
              </SelectItem>
              <SelectItem className="rounded-lg" value="7d">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          className="aspect-auto h-[250px] w-full"
          config={chartConfig}
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillLeads" x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-leads)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-leads)"
                  stopOpacity={0.1}
                />
              </linearGradient>
              <linearGradient id="fillConversions" x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-conversions)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-conversions)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
              }}
              tickLine={false}
              tickMargin={8}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  indicator="dot"
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                  }}
                />
              }
              cursor={false}
            />
            <Area
              dataKey="conversions"
              fill="url(#fillConversions)"
              stackId="a"
              stroke="var(--color-conversions)"
              type="natural"
            />
            <Area
              dataKey="leads"
              fill="url(#fillLeads)"
              stackId="a"
              stroke="var(--color-leads)"
              type="natural"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import "../styles.css";
import { Task } from "./types";

export default function Ganttchart() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const barRectsRef = useRef<
    { x0: number; x1: number; y: number; height: number; task: Task }[]
  >([]);
  const [clickedTask, setClickedTask] = useState<Task | null>(null);
  const [hoveredCircle, setHoveredCircle] = useState<{
    type: "start" | "end";
    date: string;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const [draggingBarIndex, setDraggingBarIndex] = useState<number | null>(null);
  const dragOffsetRef = useRef<number>(0);
  const [resizingStartIndex, setResizingStartIndex] = useState<number | null>(
    null
  );
  const [resizingEndIndex, setResizingEndIndex] = useState<number | null>(null);
  
  // Zoom state
  const [zoomDomain, setZoomDomain] = useState<[Date, Date] | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log(event.target.files?.[0]);
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const parsedTasks: Task[] = jsonData
          .map((row: any) => {
            const name = row.Name;
            const start = row.Start_Date;
            const end = row.Finish_Date;
            const id = row.ID;
            const successors = row.Successors;
            const resource = row["Parent Id"];
            const totalSlack = row.Total_Slack;

            function excelDateToJSDate(serial: number) {
              const utc_days = Math.floor(serial - 25569);
              const utc_value = utc_days * 86400;
              const date_info = new Date(utc_value * 1000);
              return date_info;
            }

            function parseDate(val: any) {
              if (typeof val === "number") {
                return dayjs(excelDateToJSDate(val)).format("YYYY-MM-DD");
              }

              let d = dayjs(val, "DD-MM-YYYY HH:mm");
              if (!d.isValid()) d = dayjs(val, "DD-MM-YYYY");
              if (!d.isValid()) d = dayjs(val);
              return d.isValid() ? d.format("YYYY-MM-DD") : "";
            }

            const startDateStr = parseDate(start);
            const endDateStr = parseDate(end);

            return {
              name: String(name),
              start: startDateStr,
              end: endDateStr,
              id,
              successors,
              resource: resource ? String(resource) : undefined,
              duration: totalSlack
                ? parseFloat(String(totalSlack).replace("d", ""))
                : undefined,
            };
          })
          .filter(
            (task) =>
              task.name &&
              task.start &&
              task.end &&
              task.start !== "" &&
              task.end !== ""
          );

        setTasks(parsedTasks);
        console.log("Parsed tasks:", parsedTasks);
      } catch (error) {
        console.error("Error parsing Excel file:", error);
        alert("Error parsing Excel file. Please check the file format.");
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const resolveResourceConflicts = (tasks: Task[]): Task[] => {
    if (tasks.length === 0) return tasks;

    const tasksWithResources = tasks.filter(task => task.resource && task.resource.trim() !== "");

    const resourceGroups: { [resource: string]: Task[] } = {};
    tasksWithResources.forEach(task => {
      if (!resourceGroups[task.resource!]) {
        resourceGroups[task.resource!] = [];
      }
      resourceGroups[task.resource!].push(task);
    });

    const adjustedTasks = [...tasks];

    Object.keys(resourceGroups).forEach((chainId) => {
      const chainTasks = resourceGroups[chainId]
        .map((task) => {
          const taskIndex = adjustedTasks.findIndex(t => 
            (t.id && task.id && t.id === task.id) || 
            (t.name === task.name && t.resource === task.resource)
          );
          return { task: adjustedTasks[taskIndex], index: taskIndex, originalTask: task };
        })
        .filter((item) => item.index !== -1)
        .sort((a, b) => {
          if (a.originalTask.id && b.originalTask.id) {
            return a.originalTask.id - b.originalTask.id;
          }
          return dayjs(a.originalTask.start).valueOf() - dayjs(b.originalTask.start).valueOf();
        });

      const chainStartDate = dayjs(d3.min(chainTasks, (d) => dayjs(d.originalTask.start).toDate())!);
      let currentChainDate = chainStartDate;

      chainTasks.forEach((taskItem, taskIndex) => {
        const task = taskItem.task;
        const duration = task.duration || 
          dayjs(task.end).diff(dayjs(task.start), 'day') + 1;
        
        const newStart = currentChainDate;
        const newEnd = newStart.add(duration - 1, 'day'); // End date is start + duration - 1

        adjustedTasks[taskItem.index] = {
          ...task,
          start: newStart.format("YYYY-MM-DD"),
          end: newEnd.format("YYYY-MM-DD")
        };

        // Next task starts immediately after the current task ends (no gap)
        currentChainDate = newEnd.add(1, 'day');
      });
    });

    return adjustedTasks;
  };

  useEffect(() => {
    if (!canvasRef.current || tasks.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const taskHeight = 50;
    const resourceCount = new Set(tasks.filter(task => task.resource && task.resource.trim() !== "").map(task => task.resource)).size;
    
    // Calculate minimum width needed for labels
    ctx.font = "12px Arial";
    const maxLabelWidth = Math.max(...tasks.map(task => {
      const durationDays = (dayjs(task.end).diff(dayjs(task.start), "day", true) + 1).toFixed(2).replace(/\.00$/, "");
      const text = task.resource 
        ? `${task.name} (${task.resource}) [${durationDays}d]`
        : `${task.name} [${durationDays}d]`;
      return ctx.measureText(text).width;
    }));
    
    const baseCanvasWidth = Math.max(1000, tasks.length * 100);
    const canvasWidth = Math.max(baseCanvasWidth, baseCanvasWidth + maxLabelWidth + 100); // Extra space for labels
    const canvasHeight = Math.max(400, (tasks.length + resourceCount) * taskHeight + 150);
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const margin = { top: 120, right: Math.max(200, maxLabelWidth + 50), bottom: 60, left: 200 };
    const width = canvas.width - margin.left - margin.right;
    const height = canvas.height - margin.top - margin.bottom;
    const minDate = d3.min(tasks, (d) => dayjs(d.start).toDate())!;
    const maxDate = d3.max(tasks, (d) => dayjs(d.end).toDate())!;

    if (
      !minDate ||
      !maxDate ||
      isNaN(minDate.getTime()) ||
      isNaN(maxDate.getTime())
    ) {
      console.error("Invalid date range detected");
      return;
    }

    const getResourceColor = (resource: string | undefined): string => {
      if (!resource) return "skyblue";
      const colors = [
        "#FF6B6B",
        "#4ECDC4",
        "#45B7D1",
        "#96CEB4",
        "#FECA57",
        "#FF9FF3",
        "#54A0FF",
        "#5F27CD",
        "#00D2D3",
        "#FF9F43",
        "#EA2027",
        "#006BA6",
        "#0652DD",
        "#9980FA",
        "#833471",
      ];
      let hash = 0;
      for (let i = 0; i < resource.length; i++) {
        hash = resource.charCodeAt(i) + ((hash << 5) - hash);
      }
      return colors[Math.abs(hash) % colors.length];
    };

    const resourceAggregations = new Map<string, {
      earliestStart: Date;
      latestEnd: Date;
      taskCount: number;
      color: string;
    }>();

    tasks.forEach((task) => {
      if (task.resource && task.resource.trim() !== "") {
        const resource = task.resource;
        const startDate = dayjs(task.start).toDate();
        const endDate = dayjs(task.end).toDate();
        
        if (!resourceAggregations.has(resource)) {
          resourceAggregations.set(resource, {
            earliestStart: startDate,
            latestEnd: endDate,
            taskCount: 1,
            color: getResourceColor(resource)
          });
        } else {
          const existing = resourceAggregations.get(resource)!;
          existing.earliestStart = startDate < existing.earliestStart ? startDate : existing.earliestStart;
          existing.latestEnd = endDate > existing.latestEnd ? endDate : existing.latestEnd;
          existing.taskCount++;
        }
      }
    });

    const yDomainItems: string[] = [];
    const addedResourceBars = new Set<string>();
    
    tasks.forEach((task) => {
      if (task.resource && task.resource.trim() !== "" && !addedResourceBars.has(task.resource)) {
        yDomainItems.push(`📊 ${task.resource} Resource`);
        addedResourceBars.add(task.resource);
      }
      yDomainItems.push(task.name);
    });

    // Time scale with zoom support
    const timeExtent = zoomDomain || [d3.timeMonth.floor(minDate), d3.timeMonth.ceil(maxDate)];
    const x = d3
      .scaleTime()
      .domain(timeExtent)
      .range([0, width]);
    
    const y = d3
      .scaleBand()
      .domain(yDomainItems)
      .range([0, height])
      .padding(0.2);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.fillStyle = "#000";
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("GANTT CHART", canvas.width / 2, 30);
    ctx.restore();

    ctx.font = "12px";
    ctx.textBaseline = "middle";

    // Draw chart boundaries (enhanced border to show zoom area)
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 3;
    ctx.beginPath();
    // Top border
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left + width, margin.top);
    // Right border
    ctx.lineTo(margin.left + width, margin.top + height);
    // Bottom border
    ctx.lineTo(margin.left, margin.top + height);
    // Left border
    ctx.lineTo(margin.left, margin.top);
    ctx.stroke();

    // Add subtle background to chart area
    ctx.fillStyle = "rgba(248, 249, 250, 0.3)";
    ctx.fillRect(margin.left, margin.top, width, height);

    // Dynamic Time Axis Implementation
    const [visibleStart, visibleEnd] = x.domain();
    const spanMs = visibleEnd.getTime() - visibleStart.getTime();
    const spanDays = spanMs / (1000 * 60 * 60 * 24);
    const spanYears = visibleEnd.getFullYear() - visibleStart.getFullYear();

    // Determine time unit and generate ticks based on zoom level
    let ticks: Date[] = [];
    let labelFormat: string = "";
    let majorTicks: Date[] = [];
    let majorLabelFormat: string = "";

    if (spanMs < 1000 * 60 * 60 * 2) { // Less than 2 hours - show 15-minute intervals
      ticks = d3.timeMinute.every(15)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "HH:mm";
      majorTicks = d3.timeHour.every(1)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "HH:00 - DD MMM";
    } else if (spanMs < 1000 * 60 * 60 * 12) { // Less than 12 hours - show hours
      ticks = d3.timeHour.every(1)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "HH:00";
      majorTicks = d3.timeDay.every(1)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "DD MMM YYYY";
    } else if (spanMs < 1000 * 60 * 60 * 24 * 3) { // Less than 3 days - show 6-hour intervals
      ticks = d3.timeHour.every(6)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "HH:00";
      majorTicks = d3.timeDay.every(1)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "DD MMM YYYY";
    } else if (spanDays < 30) { // Less than 30 days - show days
      ticks = d3.timeDay.every(1)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "DD";
      majorTicks = d3.timeMonth.every(1)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "MMM YYYY";
    } else if (spanDays < 180) { // Less than 6 months - show weeks
      ticks = d3.timeWeek.every(1)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "Week";
      majorTicks = d3.timeMonth.every(1)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "MMM YYYY";
    } else if (spanYears < 2) { // Less than 2 years - show months
      ticks = d3.timeMonth.every(1)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "MMM";
      majorTicks = d3.timeYear.every(1)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "YYYY";
    } else if (spanYears < 10) { // Less than 10 years - show quarters
      ticks = d3.timeMonth.every(3)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "Q";
      majorTicks = d3.timeYear.every(1)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "YYYY";
    } else if (spanYears < 100) { // Less than 100 years - show years
      ticks = d3.timeYear.every(1)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "YYYY";
      majorTicks = d3.timeYear.every(10)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "DECADE";
    } else { // 100+ years - show decades/centuries
      ticks = d3.timeYear.every(10)?.range(visibleStart, visibleEnd) || [];
      labelFormat = "DECADE";
      majorTicks = d3.timeYear.every(100)?.range(visibleStart, visibleEnd) || [];
      majorLabelFormat = "CENTURY";
    }

    // Draw major ticks (upper level)
    majorTicks.forEach((tick) => {
      const tickX = x(tick) + margin.left;
      
      // Draw major tick line
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tickX, margin.top - 15);
      ctx.lineTo(tickX, margin.top + 15);
      ctx.stroke();

      // Format and draw major label
      let majorText = "";
      if (majorLabelFormat === "HH:00 - DD MMM") {
        majorText = dayjs(tick).format("HH:00 - DD MMM");
      } else if (majorLabelFormat === "YYYY") {
        majorText = dayjs(tick).format("YYYY");
      } else if (majorLabelFormat === "MMM YYYY") {
        majorText = dayjs(tick).format("MMM YYYY");
      } else if (majorLabelFormat === "DD MMM YYYY") {
        majorText = dayjs(tick).format("DD MMM YYYY");
      } else if (majorLabelFormat === "DECADE") {
        const year = tick.getFullYear();
        majorText = `${year}s`;
      } else if (majorLabelFormat === "CENTURY") {
        const year = tick.getFullYear();
        const centuryStart = Math.floor(year / 100) * 100;
        majorText = `[${centuryStart}, ${centuryStart + 99}]`;
      }

      ctx.save();
      ctx.fillStyle = "#333";
      ctx.font = "bold 18px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      
      const textMetrics = ctx.measureText(majorText);
      const labelPadding = 8;

      ctx.fillStyle = "#f0f0f0";
      ctx.strokeStyle = "#ccc";
      ctx.lineWidth = 1;
      ctx.fillRect(
        tickX - textMetrics.width / 2 - labelPadding,
        margin.top - 70,
        textMetrics.width + labelPadding * 2,
        30
      );
      ctx.strokeRect(
        tickX - textMetrics.width / 2 - labelPadding,
        margin.top - 70,
        textMetrics.width + labelPadding * 2,
        30
      );

      ctx.fillStyle = "#333";
      ctx.fillText(majorText, tickX, margin.top - 55);
      ctx.restore();
    });

    // Draw minor ticks (lower level)
    ticks.forEach((tick) => {
      const tickX = x(tick) + margin.left;

      // Draw vertical grid line
      ctx.strokeStyle = "#e0e0e0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tickX, margin.top);
      ctx.lineTo(tickX, margin.top + height);
      ctx.stroke();

      // Draw minor tick mark
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tickX, margin.top - 5);
      ctx.lineTo(tickX, margin.top + 5);
      ctx.stroke();

      // Format and draw minor label
      let minorText = "";
      if (labelFormat === "HH:mm") {
        minorText = dayjs(tick).format("HH:mm");
      } else if (labelFormat === "HH:00") {
        minorText = dayjs(tick).format("HH:00");
      } else if (labelFormat === "HH") {
        minorText = dayjs(tick).format("HH");
      } else if (labelFormat === "DD") {
        minorText = dayjs(tick).format("DD");
      } else if (labelFormat === "Week") {
        const weekNum = Math.ceil(dayjs(tick).date() / 7);
        minorText = `W${weekNum}`;
      } else if (labelFormat === "MMM") {
        minorText = dayjs(tick).format("MMM");
      } else if (labelFormat === "Q") {
        const quarter = Math.ceil((dayjs(tick).month() + 1) / 3);
        minorText = `Q${quarter}`;
      } else if (labelFormat === "YYYY") {
        minorText = dayjs(tick).format("YYYY");
      } else if (labelFormat === "DECADE") {
        const year = tick.getFullYear();
        minorText = `${year}s`;
      }

      ctx.save();
      ctx.fillStyle = "#666";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(minorText, tickX, margin.top - 25);
      ctx.restore();
    });

    const barRects: {
      x0: number;
      x1: number;
      y: number;
      height: number;
      task: Task;
    }[] = [];

    tasks.forEach((task, i) => {
      const startDate = dayjs(task.start).toDate();
      const endDate = dayjs(task.end).toDate();

      const x0 = x(startDate) + margin.left;
      const x1 = x(endDate) + margin.left;
      const barWidth = x1 - x0;
      const barY = y(task.name)! + margin.top;
      const barHeight = y.bandwidth();

      const actualBarWidth = Math.max(barWidth, 1);

      barRects.push({
        x0,
        x1: x0 + actualBarWidth,
        y: barY,
        height: barHeight,
        task,
      });

      // Set up clipping region for bars only
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, margin.top, width, height);
      ctx.clip();

      const resourceColor = getResourceColor(task.resource);
      ctx.fillStyle = hoveredBarIndex === i ? "#ffa500" : resourceColor;
      ctx.fillRect(x0, barY, actualBarWidth, barHeight);

      ctx.strokeStyle = hoveredBarIndex === i ? "#ff8c00" : "#333";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, barY, actualBarWidth, barHeight);

      ctx.beginPath();
      ctx.arc(x0, barY + barHeight / 2, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#ff6347";
      ctx.fill();
      ctx.strokeStyle = "#b22222";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.closePath();

      ctx.beginPath();
      ctx.arc(x1, barY + barHeight / 2, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#228B22";
      ctx.fill();
      ctx.strokeStyle = "#006400";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.closePath();
      ctx.restore();

      ctx.textAlign = "left";
      const labelX = x1 + 8;
      const labelY = barY + barHeight / 2;

      const durationDays = (
        dayjs(task.end).diff(dayjs(task.start), "day", true) + 1
      )
        .toFixed(2)
        .replace(/\.00$/, "");
      const durationLabel = `${durationDays}d`;
      const text = task.resource
        ? `${task.name} (${task.resource}) [${durationLabel}]`
        : `${task.name} [${durationLabel}]`;
      ctx.font = "12px Arial";
      const textMetrics = ctx.measureText(text);
      const paddingX = 4;
      const paddingY = 4;
      
      // Calculate available space for the label (use chart boundary, not canvas boundary)
      const chartRightBoundary = margin.left + width;
      const maxLabelWidth = chartRightBoundary - labelX;
      const rectWidth = Math.min(textMetrics.width + paddingX * 2, maxLabelWidth);
      const rectHeight = 18;
      
      // Adjust label text if it's too long
      let displayText = text;
      if (textMetrics.width > maxLabelWidth - paddingX * 2) {
        // Truncate text and add ellipsis
        const availableTextWidth = Math.max(0, maxLabelWidth - paddingX * 2 - ctx.measureText("...").width);
        let truncatedText = text;
        while (ctx.measureText(truncatedText).width > availableTextWidth && truncatedText.length > 0) {
          truncatedText = truncatedText.slice(0, -1);
        }
        displayText = truncatedText.length > 0 ? truncatedText + "..." : "";
      }
      
      // Only draw label if there's enough space and text isn't empty
      if (rectWidth > 30 && displayText.length > 0) { // Minimum width threshold
        ctx.save();
        ctx.fillStyle = "#f5f5f5";
        ctx.strokeStyle = "#e0e0e0";
        ctx.lineWidth = 1;
        ctx.fillRect(
          labelX - paddingX,
          labelY - rectHeight / 2,
          rectWidth,
          rectHeight
        );
        ctx.strokeRect(
          labelX - paddingX,
          labelY - rectHeight / 2,
          rectWidth,
          rectHeight
        );
        ctx.restore();

        ctx.fillStyle = "black";
        ctx.fillText(displayText, labelX, labelY);
      }
    });

    yDomainItems.forEach((item, index) => {
      if (index < yDomainItems.length - 1) {
        const currentItemY = y(item)! + margin.top;
        const currentItemHeight = y.bandwidth();
        const nextItem = yDomainItems[index + 1];
        const nextItemY = y(nextItem)! + margin.top;
        
        const midY = (currentItemY + currentItemHeight + nextItemY) / 2;
        ctx.strokeStyle = "#e0e0e0";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, midY);
        ctx.lineTo(margin.left + width, midY);
        ctx.stroke();
      }
    });

    tasks.forEach((task) => {
      if (task.successors !== undefined && task.successors !== null) {
        const successorTask = tasks.find((t) => t.id === task.successors);
        if (successorTask) {
          // Set up clipping region for connections
          ctx.save();
          ctx.beginPath();
          ctx.rect(margin.left, margin.top, width, height);
          ctx.clip();

          const startDate = dayjs(task.end).toDate();
          const x1 = x(startDate) + margin.left;
          const barY = y(task.name)! + margin.top;
          const barHeight = y.bandwidth();

          const successorStartDate = dayjs(successorTask.start).toDate();
          const successorBarY = y(successorTask.name)! + margin.top;
          const successorBarHeight = y.bandwidth();
          const successorX0 = x(successorStartDate) + margin.left;

          const startY = barY + barHeight / 2;
          const endY = successorBarY + successorBarHeight / 2;
          const midY = (startY + endY) / 2;

          const verticalDistance = Math.abs(endY - startY);
          const offsetX = Math.max(40, verticalDistance / 2);

          const padding = 6;
          const fromX = x1 + padding;
          const toX = successorX0 - padding;

          ctx.save();
          ctx.strokeStyle = "#007acc";
          ctx.lineWidth = 2;
          ctx.shadowColor = "rgba(0,0,0,0.2)";
          ctx.shadowBlur = 4;

          ctx.beginPath();
          ctx.moveTo(fromX, startY);
          ctx.bezierCurveTo(
            fromX + offsetX,
            midY,
            toX - offsetX,
            midY,
            toX,
            endY
          );
          ctx.lineTo(successorX0, endY);
          ctx.stroke();

          const arrowLength = 7;
          const angle = Math.atan2(endY - midY, successorX0 - offsetX);

          ctx.beginPath();
          ctx.moveTo(successorX0, endY);
          ctx.lineTo(
            successorX0 - arrowLength * Math.cos(angle - Math.PI / 6),
            endY - arrowLength * Math.sin(angle - Math.PI / 6)
          );

          ctx.moveTo(successorX0, endY);
          ctx.lineTo(
            successorX0 - arrowLength * Math.cos(angle + Math.PI / 6),
            endY - arrowLength * Math.sin(angle + Math.PI / 6)
          );

          ctx.stroke();
          ctx.restore();
        }
      }
    });

    resourceAggregations.forEach((resourceInfo, resourceName) => {
      const resourceRowName = `📊 ${resourceName} Resource`;
      const resourceBarY = y(resourceRowName)! + margin.top;
      const resourceBarHeight = y.bandwidth();
      
      const resourceStartDate = resourceInfo.earliestStart;
      const resourceEndDate = resourceInfo.latestEnd;
      
      const resourceX0 = x(resourceStartDate) + margin.left;
      const resourceX1 = x(resourceEndDate) + margin.left;
      const resourceBarWidth = resourceX1 - resourceX0;
      
      const actualResourceBarWidth = Math.max(resourceBarWidth, 1);
      
      // Set up clipping region for resource bars
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, margin.top, width, height);
      ctx.clip();
      
      ctx.fillStyle = "black";
      ctx.fillRect(resourceX0, resourceBarY, actualResourceBarWidth, resourceBarHeight);
      
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.strokeRect(resourceX0, resourceBarY, actualResourceBarWidth, resourceBarHeight);
      
      ctx.restore(); // Restore clipping for resource bar
      
      ctx.textAlign = "left";
      const resourceLabelX = resourceX1 + 8;
      const resourceLabelY = resourceBarY + resourceBarHeight / 2;
      
      const totalDurationDays = (dayjs(resourceEndDate).diff(dayjs(resourceStartDate), 'day', true) + 1).toFixed(2).replace(/\.00$/, '');
      const resourceText = `${resourceName} (${resourceInfo.taskCount} tasks) [${totalDurationDays}d total]`;
      
      ctx.font = "bold 12px Arial";
      ctx.fillStyle = "black";
      
      // Calculate available space for the resource label (use chart boundary)
      const chartRightBoundary = margin.left + width;
      const maxResourceLabelWidth = chartRightBoundary - resourceLabelX;
      const resourceTextMetrics = ctx.measureText(resourceText);
      
      // Adjust resource label text if it's too long
      let displayResourceText = resourceText;
      if (resourceTextMetrics.width > maxResourceLabelWidth) {
        // Truncate text and add ellipsis
        const availableTextWidth = Math.max(0, maxResourceLabelWidth - ctx.measureText("...").width);
        let truncatedText = resourceText;
        while (ctx.measureText(truncatedText).width > availableTextWidth && truncatedText.length > 0) {
          truncatedText = truncatedText.slice(0, -1);
        }
        displayResourceText = truncatedText.length > 0 ? truncatedText + "..." : "";
      }
      
      // Only draw label if there's enough space and text isn't empty
      if (maxResourceLabelWidth > 50 && displayResourceText.length > 0) { // Minimum width threshold
        ctx.fillText(displayResourceText, resourceLabelX, resourceLabelY);
      }
    });

    barRectsRef.current = barRects;
  }, [tasks, hoveredBarIndex, zoomDomain, zoomLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let isHoveringBarOrCircle = false;

    function getHoveredBarOrCircle(x: number, y: number) {
      for (let i = 0; i < barRectsRef.current.length; i++) {
        const bar = barRectsRef.current[i];

        const startCx = bar.x0,
          startCy = bar.y + bar.height / 2;
        if (Math.sqrt((x - startCx) ** 2 + (y - startCy) ** 2) <= 8) {
          return { type: "start", bar, x: startCx, y: startCy, index: i };
        }

        const endCx = bar.x1,
          endCy = bar.y + bar.height / 2;
        if (Math.sqrt((x - endCx) ** 2 + (y - endCy) ** 2) <= 8) {
          return { type: "end", bar, x: endCx, y: endCy, index: i };
        }

        if (
          x >= bar.x0 &&
          x <= bar.x1 &&
          y >= bar.y &&
          y <= bar.y + bar.height
        ) {
          return { type: "bar", bar, index: i };
        }
      }
      return null;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      if (resizingStartIndex !== null) {
        const bar = barRectsRef.current[resizingStartIndex];
        if (!bar) return;

        const margin = { top: 120, right: 200, bottom: 60, left: 200 };
        const width = canvas.width - margin.left - margin.right;
        const minDate = d3.min(tasks, (d) => dayjs(d.start).toDate())!;
        const maxDate = d3.max(tasks, (d) => dayjs(d.end).toDate())!;
        const xScale = d3
          .scaleTime()
          .domain([d3.timeMonth.floor(minDate), d3.timeMonth.ceil(maxDate)])
          .range([0, width]);

        const clampedX = Math.max(margin.left - 100, Math.min(x, bar.x1 - 1));
        let newStartDate = xScale.invert(clampedX - margin.left);

        if (dayjs(newStartDate).isAfter(dayjs(bar.task.end))) return;

        const currentMinDate = d3.timeMonth.floor(minDate);
        if (dayjs(newStartDate).isBefore(currentMinDate)) {
          newStartDate = dayjs(currentMinDate).subtract(1, "month").toDate();
        }

        setTasks((prevTasks) => {
          const updated = [...prevTasks];
          updated[resizingStartIndex] = {
            ...updated[resizingStartIndex],
            start: dayjs(newStartDate).format("YYYY-MM-DD"),
          };
          return updated;
        });
        return;
      }

      if (resizingEndIndex !== null) {
        const bar = barRectsRef.current[resizingEndIndex];
        if (!bar) return;

        const margin = { top: 120, right: 200, bottom: 60, left: 200 };
        const width = canvas.width - margin.left - margin.right;
        const minDate = d3.min(tasks, (d) => dayjs(d.start).toDate())!;
        const maxDate = d3.max(tasks, (d) => dayjs(d.end).toDate())!;
        const xScale = d3
          .scaleTime()
          .domain([d3.timeMonth.floor(minDate), d3.timeMonth.ceil(maxDate)])
          .range([0, width]);

        const clampedX = Math.max(
          bar.x0 + 1,
          Math.min(x, margin.left + width + 100)
        );
        let newEndDate = xScale.invert(clampedX - margin.left);

        if (dayjs(newEndDate).isBefore(dayjs(bar.task.start))) return;

        const currentMaxDate = d3.timeMonth.ceil(maxDate);
        if (dayjs(newEndDate).isAfter(currentMaxDate)) {
          newEndDate = dayjs(currentMaxDate).add(1, "month").toDate();
        }

        setTasks((prevTasks) => {
          const updated = [...prevTasks];
          updated[resizingEndIndex] = {
            ...updated[resizingEndIndex],
            end: dayjs(newEndDate).format("YYYY-MM-DD"),
          };
          return updated;
        });
        return;
      }

      if (draggingBarIndex !== null) {
        const bar = barRectsRef.current[draggingBarIndex];
        if (!bar) return;

        const margin = { top: 120, right: 200, bottom: 60, left: 200 };
        const width = canvas.width - margin.left - margin.right;
        const minDate = d3.min(tasks, (d) => dayjs(d.start).toDate())!;
        const maxDate = d3.max(tasks, (d) => dayjs(d.end).toDate())!;
        const xScale = d3
          .scaleTime()
          .domain([d3.timeMonth.floor(minDate), d3.timeMonth.ceil(maxDate)])
          .range([0, width]);

        const mouseX = x - dragOffsetRef.current;

        const clampedX = Math.max(
          margin.left - 100,
          Math.min(mouseX, margin.left + width + 100 - (bar.x1 - bar.x0))
        );

        let newStartDate = xScale.invert(clampedX - margin.left);
        const durationMs = dayjs(bar.task.end).diff(dayjs(bar.task.start));
        let newEndDate = dayjs(newStartDate)
          .add(durationMs, "millisecond")
          .toDate();

        const currentMinDate = d3.timeMonth.floor(minDate);
        if (dayjs(newStartDate).isBefore(currentMinDate)) {
          newStartDate = dayjs(currentMinDate).subtract(1, "month").toDate();
          newEndDate = dayjs(newStartDate)
            .add(durationMs, "millisecond")
            .toDate();
        }

        const currentMaxDate = d3.timeMonth.ceil(maxDate);
        if (dayjs(newEndDate).isAfter(currentMaxDate)) {
          newEndDate = dayjs(currentMaxDate).add(1, "month").toDate();
          newStartDate = dayjs(newEndDate)
            .subtract(durationMs, "millisecond")
            .toDate();
        }

        setTasks((prevTasks) => {
          const updated = [...prevTasks];
          updated[draggingBarIndex] = {
            ...updated[draggingBarIndex],
            start: dayjs(newStartDate).format("YYYY-MM-DD"),
            end: dayjs(newEndDate).format("YYYY-MM-DD"),
          };
          return updated;
        });
        return;
      }

      const hovered = getHoveredBarOrCircle(x, y);
      if (hovered) {
        canvas.style.cursor = "pointer";
        isHoveringBarOrCircle = true;
        setHoveredBarIndex(hovered.index ?? null);
        if (hovered.type === "start") {
          setHoveredCircle({
            type: "start",
            date: hovered.bar.task.start,
            x: e.clientX,
            y: e.clientY,
          });
        } else if (hovered.type === "end") {
          setHoveredCircle({
            type: "end",
            date: hovered.bar.task.end,
            x: e.clientX,
            y: e.clientY,
          });
        } else {
          setHoveredCircle(null);
        }
      } else {
        // Check if mouse is within chart boundaries for zoom cursor
        const margin = { top: 120, right: 200, bottom: 60, left: 200 };
        const width = canvas.width - margin.left - margin.right;
        const height = canvas.height - margin.top - margin.bottom;
        
        if (x >= margin.left && x <= margin.left + width && 
            y >= margin.top && y <= margin.top + height) {
          canvas.style.cursor = "zoom-in"; // Show zoom cursor in chart area
        } else {
          canvas.style.cursor = "default";
        }
        
        isHoveringBarOrCircle = false;
        setHoveredBarIndex(null);
        setHoveredCircle(null);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const hovered = getHoveredBarOrCircle(x, y);
      if (hovered) {
        if (hovered.type === "bar") {
          setDraggingBarIndex(hovered.index);
          dragOffsetRef.current = x - hovered.bar.x0;
        } else if (hovered.type === "start") {
          setResizingStartIndex(hovered.index);
        } else if (hovered.type === "end") {
          setResizingEndIndex(hovered.index);
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      setDraggingBarIndex(null);
      setResizingStartIndex(null);
      setResizingEndIndex(null);
    };

    const handleClick = (e: MouseEvent) => {
      if (!isHoveringBarOrCircle) return;
      const rect = canvas.getBoundingClientRect();

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      const hovered = getHoveredBarOrCircle(x, y);
      if (hovered && hovered.bar) {
        setClickedTask(hovered.bar.task);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;
      
      // Calculate chart boundaries (use same margin calculation as in chart setup)
      const margin = { top: 120, right: 200, bottom: 60, left: 200 };
      const width = canvas.width - margin.left - margin.right;
      const height = canvas.height - margin.top - margin.bottom;
      
      // Check if mouse is within chart boundaries
      if (mouseX < margin.left || mouseX > margin.left + width || 
          mouseY < margin.top || mouseY > margin.top + height) {
        return; // Don't zoom if mouse is outside chart area
      }
      
      // Calculate zoom parameters
      const minDate = d3.min(tasks, (d) => dayjs(d.start).toDate())!;
      const maxDate = d3.max(tasks, (d) => dayjs(d.end).toDate())!;;
      
      // Get current domain (either zoom domain or full domain)
      const currentDomain = zoomDomain || [d3.timeMonth.floor(minDate), d3.timeMonth.ceil(maxDate)];
      const timeScale = d3.scaleTime().domain(currentDomain).range([0, width]);
      
      // Get the date at mouse position
      const mouseDate = timeScale.invert(mouseX - margin.left);
      
      // Calculate gradual zoom factor based on current zoom level
      const currentZoomLevel = zoomLevel || 1;
      
      // Progressive zoom factor: slower zooming at higher zoom levels
      // Formula: zoomSpeed = baseSpeed / (1 + zoomLevel * dampingFactor)
      const baseSpeed = 0.1; // Base zoom speed (10% per wheel tick)
      const dampingFactor = 0.02; // How much to slow down at higher zoom levels
      const zoomSpeed = baseSpeed / (1 + currentZoomLevel * dampingFactor);
      
      // Apply zoom direction with progressive speed
      const zoomFactor = e.deltaY > 0 ? (1 + zoomSpeed) : (1 - zoomSpeed);
      
      // Calculate new domain
      const currentSpan = currentDomain[1].getTime() - currentDomain[0].getTime();
      const newSpan = currentSpan * zoomFactor;
      
      // Calculate mouse position ratio within current domain
      const mouseRatio = (mouseDate.getTime() - currentDomain[0].getTime()) / currentSpan;
      
      // Calculate new domain bounds centered around mouse position
      const newStartTime = mouseDate.getTime() - (newSpan * mouseRatio);
      const newEndTime = mouseDate.getTime() + (newSpan * (1 - mouseRatio));
      
      const newStart = new Date(newStartTime);
      const newEnd = new Date(newEndTime);
      
      // Constrain zoom to reasonable bounds
      const originalSpan = d3.timeMonth.ceil(maxDate).getTime() - d3.timeMonth.floor(minDate).getTime();
      const maxZoomOut = originalSpan * 1.5; // Allow zoom out to 1.5x original span
      const minZoomIn = 1000 * 60 * 30; // Minimum 30 minutes span
      const maxZoomLevel = 1000; // Maximum zoom level
      
      // Calculate new zoom level
      const newZoomLevel = originalSpan / newSpan;
      
      if (newSpan > maxZoomOut) {
        // Reset to full view if zooming out too much
        setZoomDomain(null);
        setZoomLevel(1);
      } else if (newSpan < minZoomIn || newZoomLevel > maxZoomLevel) {
        // Don't zoom in further than limits
        return;
      } else {
        setZoomDomain([newStart, newEnd]);
        setZoomLevel(newZoomLevel);
      }
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("wheel", handleWheel);
    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [draggingBarIndex, resizingStartIndex, resizingEndIndex, tasks, zoomDomain, zoomLevel]);

  return (
    <div>
      <div style={{ marginBottom: "20px" }}>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileUpload}
          style={{
            padding: "10px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            marginRight: "10px",
          }}
        />
        <button
          onClick={() => {
            if (tasks.length > 0) {
              const scheduledTasks = resolveResourceConflicts(tasks);
              setTasks(scheduledTasks);
              console.log("Re-scheduled tasks:", scheduledTasks);
            }
          }}
          style={{
            padding: "10px 15px",
            border: "1px solid #007bff",
            borderRadius: "4px",
            backgroundColor: "#007bff",
            color: "white",
            cursor: "pointer",
            marginLeft: "10px",
          }}
        >
          Schedule Resources
        </button>
        <button
          onClick={() => {
            setZoomDomain(null);
            setZoomLevel(1);
          }}
          style={{
            padding: "10px 15px",
            border: "1px solid #28a745",
            borderRadius: "4px",
            backgroundColor: "#28a745",
            color: "white",
            cursor: "pointer",
            marginLeft: "10px",
          }}
        >
          Reset Zoom
        </button>
        <div style={{ 
          display: "inline-block", 
          marginLeft: "15px", 
          fontSize: "14px", 
          color: "#666",
          verticalAlign: "middle"
        }}>
          {zoomDomain ? `Zoom: ${zoomLevel < 10 ? zoomLevel.toFixed(1) : Math.round(zoomLevel)}x` : "Full View"} | Hover over chart area and use mouse wheel to zoom
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          border: "2px solid black",
          maxWidth: "100%",
          height: "auto",
          display: "block",
        }}
      />
      {/* Tooltip for start/end date */}
      {hoveredCircle && (
        <div
          style={{
            position: "fixed",
            left: hoveredCircle.x + 12,
            top: hoveredCircle.y - 10,
            background: "#222",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: "6px",
            fontSize: "13px",
            pointerEvents: "none",
            zIndex: 9999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            whiteSpace: "nowrap",
          }}
        >
          {hoveredCircle.type === "start"
            ? `Start: ${hoveredCircle.date}`
            : `End: ${hoveredCircle.date}`}
        </div>
      )}
      {clickedTask && (
        <div
          style={{
            marginTop: "20px",
            padding: "10px",
            background: "#f0f0f0",
            borderRadius: "6px",
            border: "1px solid #ccc",
            maxWidth: "400px",
          }}
        >
          <strong>Clicked Task:</strong>
          <br />
          Name: {clickedTask.name}
          <br />
          Start: {clickedTask.start}
          <br />
          End: {clickedTask.end}
          <br />
          {clickedTask.resource && (
            <>
              Resource: {clickedTask.resource}
              <br />
            </>
          )}
          Duration:{" "}
          {(
            dayjs(clickedTask.end).diff(dayjs(clickedTask.start), "day", true) +
            1
          )
            .toFixed(2)
            .replace(/\.00$/, "")}
          d<br />
        </div>
      )}
    </div>
  );
}

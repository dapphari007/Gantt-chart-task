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

  useEffect(() => {
    if (!canvasRef.current || tasks.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const taskHeight = 50;
    const canvasWidth = Math.max(1000, tasks.length * 100);
    const canvasHeight = Math.max(400, tasks.length * taskHeight + 150);
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const margin = { top: 120, right: 200, bottom: 60, left: 200 };
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

    const x = d3
      .scaleTime()
      .domain([d3.timeMonth.floor(minDate), d3.timeMonth.ceil(maxDate)])
      .range([0, width]);
    const y = d3
      .scaleBand()
      .domain(tasks.map((d) => d.name))
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

    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left + width, margin.top);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + height);
    ctx.stroke();

    const monthTicks = d3.timeMonth.range(
      d3.timeMonth.floor(minDate),
      d3.timeMonth.ceil(maxDate)
    );

    monthTicks.forEach((tick) => {
      const tickX = x(tick) + margin.left;

      ctx.strokeStyle = "#e0e0e0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tickX, margin.top);
      ctx.lineTo(tickX, margin.top + height);
      ctx.stroke();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tickX, margin.top - 10);
      ctx.lineTo(tickX, margin.top + 10);
      ctx.stroke();
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.font = "bold 16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const monthText = dayjs(tick).format("MMM YYYY");
      const textMetrics = ctx.measureText(monthText);
      const labelPadding = 8;

      ctx.fillStyle = "#f8f9fa";
      ctx.strokeStyle = "#dee2e6";
      ctx.lineWidth = 1;
      ctx.fillRect(
        tickX - textMetrics.width / 2 - labelPadding,
        margin.top - 50,
        textMetrics.width + labelPadding * 2,
        25
      );
      ctx.strokeRect(
        tickX - textMetrics.width / 2 - labelPadding,
        margin.top - 50,
        textMetrics.width + labelPadding * 2,
        25
      );

      ctx.fillStyle = "#000";
      ctx.fillText(monthText, tickX, margin.top - 37);
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

      ctx.fillStyle = hoveredBarIndex === i ? "#ffa500" : "skyblue";
      ctx.fillRect(x0, barY, actualBarWidth, barHeight);

      ctx.strokeStyle = hoveredBarIndex === i ? "#ff8c00" : "#4682b4";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, barY, actualBarWidth, barHeight);

      ctx.save();
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
      const text = task.name;
      ctx.font = "12px Arial";
      const textMetrics = ctx.measureText(text);
      const paddingX = 0;
      const paddingY = 4;
      const rectWidth = textMetrics.width + paddingX * 2;
      const rectHeight = 18;
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
      ctx.fillText(text, labelX, labelY);

      if (i < tasks.length - 1) {
        const nextBarY = y(tasks[i + 1].name)! + margin.top;
        const midY = (barY + barHeight + nextBarY) / 2;
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

    barRectsRef.current = barRects;
  }, [tasks, hoveredBarIndex]);

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
        canvas.style.cursor = "default";
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

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("click", handleClick);
    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("click", handleClick);
    };
  }, [draggingBarIndex, resizingStartIndex, resizingEndIndex, tasks]);

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
        </div>
      )}
    </div>
  );
}

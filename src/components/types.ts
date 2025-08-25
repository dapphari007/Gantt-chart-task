export interface Task {
  name: string;
  start: string;
  end: string;
  successors: number;
  id: number;
}
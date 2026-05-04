import { Route, Routes } from "react-router-dom";
import Scoreboard from "./routes/Scoreboard";
import Dashboard from "./routes/Dashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Scoreboard />} />
      <Route path="/dashboard" element={<Dashboard />} />
    </Routes>
  );
}

import { useEffect, useState } from "react";

export function App() {
  const [message, setMessage] = useState("loading…");

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((d) => setMessage(d.message))
      .catch(() => setMessage("api unreachable"));
  }, []);

  return (
    <main>
      <h1>chttp + React</h1>
      <p>
        Server says: <strong>{message}</strong>
      </p>
    </main>
  );
}

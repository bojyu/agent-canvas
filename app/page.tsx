"use client";

import dynamic from "next/dynamic";

const FlowCanvas = dynamic(() => import("./FlowCanvas"), {
  ssr: false,
  loading: () => (
    <main className="node-app node-loading">
      <div><span>P</span><strong>正在载入节点画板…</strong></div>
    </main>
  ),
});

export default function Home() {
  return <FlowCanvas />;
}

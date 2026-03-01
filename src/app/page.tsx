import Image from "next/image";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-col items-center justify-center min-h-screen bg-linear-to-br from-blue-100 to-blue-300">
        <h1 className="text-4xl font-bold text-gray-800 mb-4">☁️ Mindcluster</h1>
        <p className="text-gray-600">Dia ensolarado; sem nuvens.</p>
      </main>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold">Tuition Escrow</h1>
      <p className="text-gray-600 text-center max-w-md">
        Purpose-bound school-fee payments on Stellar. Select your role to continue.
      </p>
      <div className="flex gap-4 flex-wrap justify-center">
        <a
          href="/funder"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none"
        >
          I am a Funder
        </a>
        <a
          href="/school"
          className="rounded-lg bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-green-500 focus:outline-none"
        >
          I am a School
        </a>
        <a
          href="/attester"
          className="rounded-lg bg-purple-600 px-6 py-3 text-white font-medium hover:bg-purple-700 focus-visible:ring-2 focus-visible:ring-purple-500 focus:outline-none"
        >
          I am an Attester
        </a>
      </div>
    </div>
  );
}

import Hero from "@/components/landing/Hero";
import DominanceMatrix from "@/components/landing/DominanceMatrix";
import TheProblem from "@/components/landing/TheProblem";
import ProtocolMechanics from "@/components/landing/ProtocolMechanics";
import SolverProgram from "@/components/landing/SolverProgram";
import Distribution from "@/components/landing/Distribution";
import OnChainVerifiability from "@/components/landing/OnChainVerifiability";
import Close from "@/components/landing/Close";

export default function Home() {
  return (
    <main className="bg-vynx-bg">
      <Hero />
      <DominanceMatrix />
      <TheProblem />
      <ProtocolMechanics />
      <SolverProgram />
      <Distribution />
      <OnChainVerifiability />
      <Close />
    </main>
  );
}

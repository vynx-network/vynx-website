export default function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)] mt-auto">
      <div className="max-w-360 mx-auto px-6 md:px-12 lg:px-20 pt-6 pb-8 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
        <span className="font-mono text-[11px] text-vynx-faint">
          The machines demand their own physics
        </span>
        <a
          href="mailto:cristian@vynx.network"
          className="font-mono text-[11px] text-vynx-faint hover:text-vynx-text transition-colors duration-200"
        >
          cristian@vynx.network
        </a>
        <span className="font-mono text-[11px] text-vynx-faint">
          Dedicated to Alba, for the teachings and support on this project
        </span>
      </div>
    </footer>
  );
}

interface DocsLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function DocsLayout({ sidebar, children }: DocsLayoutProps) {
  return (
    <div className="flex flex-row min-h-screen max-w-360 mx-auto w-full px-6 md:px-12 lg:px-20">
      {sidebar}
      <main className="flex-1 min-w-0 max-w-250 lg:pl-12 py-16">
        {children}
      </main>
    </div>
  );
}

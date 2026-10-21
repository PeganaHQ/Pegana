import type { Metadata } from "next";
import Link from "@/components/atoms/intent-link";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import { PillPrimary, PillGhost } from "@/components/organisms/v2/shared";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { JsonLd } from "@/components/atoms/json-ld";
import { FAQ } from "@/lib/content/faq";

// Question-shaped answers, in the words people actually use.
//
// WHY THIS PAGE EXISTS: answer engines quote question→answer text far more
// readily than prose, and the site had no Q&A surface anywhere. Everything here
// is already true and already documented — /methodology, /agents and the
// honesty page all cover it — but none of it was phrased as the question a
// person types. This is not new claims; it is the existing claims in the
// retrievable shape.
//
// HONESTY RULE FOR THIS FILE: an FAQ is the easiest place in a product to
// overclaim, because the format invites confident one-liners. Every answer here
// has to survive the same bar as the rest of the site — where the honest answer
// is "no" or "not always", it says so.

export const metadata: Metadata = pageMetadata({
  title: "Frequently asked questions",
  description:
    "How Pegana decides an asset is depegged, what the five peg states mean, how to verify any alert yourself with the open-source CLI, and, stated plainly, what Pegana cannot detect.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="FAQ"
        h1="Questions, answered plainly."
        maxWidthCh={20}
        lede={
          <>
            Including the ones with uncomfortable answers. If Pegana can&rsquo;t
            do something, it says so here rather than leaving you to find out
            during a depeg.
          </>
        }
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        {FAQ.map(({ q, a }) => (
          <section key={q} className="border-t border-[var(--v2-line)] py-8">
            <h2 className="text-[21px] font-medium tracking-[-0.015em] text-[var(--v2-text)]">
              {q}
            </h2>
            <p className="mt-3 max-w-[68ch] text-[15.5px] leading-[1.65] text-[var(--v2-body)]">
              {a}
            </p>
          </section>
        ))}

        <div className="mt-10 flex flex-wrap gap-3.5">
          <PillPrimary href="/methodology">Read the methodology</PillPrimary>
          <PillGhost href={"/assets"}>Browse every asset</PillGhost>
        </div>

        <p className="mt-8 font-mono text-[11.5px] leading-[1.7] text-[var(--v2-muted)]">
          The full list of what Pegana does not model lives on the{" "}
          <Link
            href="https://docs.pegana.xyz/methodology/honesty"
            className="underline decoration-dotted underline-offset-2 hover:text-[var(--v2-text)]"
          >
            honesty page
          </Link>
          . Pegana is a verifiable computation log. Not an audit, not a
          guarantee, not financial advice.
        </p>
      </div>

      {/*
        FAQPage structured data. Every mainEntity here is a VISIBLE question and
        answer on this page, verbatim — Google's guidelines require that, and
        marking up content a user cannot see is exactly the kind of shortcut a
        trust product should never take.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        }}
      />
    </main>
  );
}

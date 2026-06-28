import { renderRichText, shouldRenderRichText } from "./codeSyntaxRenderer";

type RichTextProps = {
  text: string;
};

export function RichText({ text }: RichTextProps) {
  if (!shouldRenderRichText(text)) {
    return <>{text}</>;
  }

  return (
    <span
      className="qc-rich-text"
      dangerouslySetInnerHTML={{ __html: renderRichText(text) }}
    />
  );
}

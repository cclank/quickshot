export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type ShapeFill = "none" | "soft" | "solid";
export type TextStyle = "plain" | "pill" | "outline";
export type RedactMode = "pixelate" | "blur";

type AnnotationBase = { id: string };

export type RectAnnotation = AnnotationBase & {
	kind: "rect";
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	width: number;
	fill: ShapeFill;
};

export type EllipseAnnotation = AnnotationBase & {
	kind: "ellipse";
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	width: number;
	fill: ShapeFill;
};

export type ArrowAnnotation = AnnotationBase & {
	kind: "arrow";
	from: Point;
	to: Point;
	color: string;
	width: number;
};

export type LineAnnotation = AnnotationBase & {
	kind: "line";
	from: Point;
	to: Point;
	color: string;
	width: number;
};

export type PenAnnotation = AnnotationBase & {
	kind: "pen";
	points: Point[];
	color: string;
	width: number;
};

export type HighlighterAnnotation = AnnotationBase & {
	kind: "highlighter";
	points: Point[];
	color: string;
	width: number;
};

export type TextAnnotation = AnnotationBase & {
	kind: "text";
	/** Top-left corner of the text box, including its padding. */
	x: number;
	y: number;
	text: string;
	color: string;
	size: number;
	style: TextStyle;
};

export type CounterAnnotation = AnnotationBase & {
	kind: "counter";
	/** Centre of the badge. */
	x: number;
	y: number;
	value: number;
	color: string;
	/** Badge radius. */
	size: number;
};

export type RedactAnnotation = AnnotationBase & {
	kind: "redact";
	x: number;
	y: number;
	w: number;
	h: number;
	mode: RedactMode;
	/** Pixel block size, or blur radius, in image pixels. */
	strength: number;
};

export type Annotation =
	| RectAnnotation
	| EllipseAnnotation
	| ArrowAnnotation
	| LineAnnotation
	| PenAnnotation
	| HighlighterAnnotation
	| TextAnnotation
	| CounterAnnotation
	| RedactAnnotation;

export type AnnotationKind = Annotation["kind"];
export type Tool = "select" | AnnotationKind;

export type BoxAnnotation = RectAnnotation | EllipseAnnotation | RedactAnnotation;
export type SegmentAnnotation = ArrowAnnotation | LineAnnotation;
export type PathAnnotation = PenAnnotation | HighlighterAnnotation;

export type HandleId =
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w"
	| "start"
	| "end";

export type Handle = { id: HandleId; x: number; y: number };

export type TextBox = {
	w: number;
	h: number;
	lines: string[];
	lineHeight: number;
	padX: number;
	padY: number;
	ascent: number;
};

/** Measures a text annotation's box in image pixels. Injected so hit testing stays DOM-free. */
export type TextMeasurer = (annotation: TextAnnotation) => TextBox;

import { Stream } from "effect";

export type OpenClawStream<A, E = unknown, R = never> = Stream.Stream<A, E, R>;

export function asyncIterableStream<A, E = unknown>(
  iterable: AsyncIterable<A>,
  onError: (error: unknown) => E = (error) => error as E,
): OpenClawStream<A, E> {
  return Stream.fromAsyncIterable(iterable, onError);
}

export function openClawStreamToAsyncIterable<A, E>(
  stream: OpenClawStream<A, E>,
): AsyncIterable<A> {
  return Stream.toAsyncIterable(stream);
}

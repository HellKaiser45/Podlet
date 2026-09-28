import { JSX } from "solid-js";

type props = {
  children: JSX.Element,
  class?: string;
}

export default function IconWrapper(props: props) {
  return (
    <>
      <div class={`inline-flex items-center justify-center ${props.class ?? ""}`}>
        {props.children}
      </div>
    </>
  )
}

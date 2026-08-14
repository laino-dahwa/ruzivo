'use client'

import { useState } from "react";

export default function Home() {
  const [stuff , setStuff] = useState("testing")


  async function handleSubmit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault()
    
    //const response = await fetch(`/api/schools/${stuff}`);
    const response = await fetch(`/api/schools/${stuff}/academic_years`);
    const data = await response.json()
    console.log(data)

  }
  return (
    <>
     <div>
      <form onSubmit={handleSubmit}>
        <input 
        type="text" 
        placeholder="Enter Something"
        name="stuff"
        value={stuff}
        onChange={(e)=>setStuff(e.target.value)}/>
        <button type="submit">Click Me</button>
      </form>
     </div>
    </>
  );
}

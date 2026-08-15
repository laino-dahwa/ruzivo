'use client'

import { useState } from "react";


type school ={
    school_id :string
    school_name :string,
    school_type :string,
    school_address :string,
    school_contact :string,
    school_email :string,
}


export default function Home() {
  const [stuff , setStuff] = useState("testing")


  async function handleSubmit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault()
    
    //Getting school resources
    //const response = await fetch(`/api/schools/${stuff}`);
    //const response = await fetch(`/api/schools/${stuff}/academic_years`);
    //const response = await fetch(`/api/schools/${stuff}/class_categories`)
    //const response = await fetch(`/api/schools/${stuff}/expense_categories`)
    //const response = await fetch(`/api/schools/${stuff}/expenses`)
    //const response = await fetch(`/api/schools/${stuff}/gender`)
    //const response = await fetch(`/api/schools/${stuff}/income_categories`)
    //const response = await fetch(`/api/schools/${stuff}/payment_methods`)
    //const response = await fetch(`/api/schools/${stuff}/payment_periods`)

    //Getting learners 
    //const response = await fetch(`/api/learners?learner_id=${null}&class_name=${"Grade 1"}&gender_name=${"Male"}&academic_year=${"2026"}`);

    //Getting payments 
    //const response = await fetch(`/api/learners/payments?learner_id=${"SSV99KD8"}&class_name=${null}&gender_name=${null}&academic_year=${null}&income_name=${null}&payment_period=${null}&method_name=${null}`);

    //Getting owings
    //const response = await fetch(`/api/learners/balances?learner_id=${null}&class_name=${null}&gender_name=${null}&academic_year=${null}&income_name=${null}&payment_period=${null}`);

    
    {/**
    if(!response.ok){
      const error = await response.json()
    }  
      
      */}

      
    const schools = [
      {
        'school_id':'SGH',
        'school_name':'Southde View Juor Schl',
        'school_type':'Primary School',
        'school_address':'Harare, Zimbabwe',
        'school_contact':'0772000000',
        'school_email':'info@ssvschool.com'
      }
    ]

    const response = await fetch("api/schools/",
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify(schools)
      }
    )
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

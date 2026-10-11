(()=>{
  const root=globalThis;
  const ADAPTER_VERSION="markdown-math-speech-adapter-v1";
  const DEFAULT_LOCALE="zh-Hans";
  const DEFAULT_STYLE="concise";
  const LIMITS=Object.freeze({maxInputChars:24000,maxTextChars:8192,maxLatexChars:4096,maxSegments:32,maxRequestChars:120000,maxContextChars:512,timeoutMs:8000});
  const NARRATION_LABEL=/^(?:\u65c1\u767d|\u753b\u5916\u97f3|\u5185\u5fc3\u72ec\u767d|\u52a8\u4f5c\u63cf\u5199|\u573a\u666f\u63cf\u5199|Narrator|Narration|Voice[- ]?over|Inner monologue|Action|Scene description)\s*[:\uff1a]/i;

  function isEscapedAt(value,index){let count=0;for(let i=index-1;i>=0&&value[i]==="\\";i--)count++;return count%2===1}
  function lineEndAt(value,index){const end=value.indexOf("\n",index);return end<0?value.length:end}
  function findUnescaped(value,token,from,limit){let index=value.indexOf(token,from);while(index>=0&&(typeof limit!=="number"||index<limit)){if(!isEscapedAt(value,index))return index;index=value.indexOf(token,index+1)}return-1}
  function readFenceAt(value,index){
    if(index>0&&value[index-1]!=="\n")return null;
    const lineEnd=lineEndAt(value,index),line=value.slice(index,lineEnd).replace(/\r$/,""),match=line.match(/^ {0,3}(`{3,}|~{3,})[^\r\n]*$/);
    if(!match)return null;
    const marker=match[1],markerChar=marker[0],closePattern=new RegExp("^ {0,3}"+markerChar+"{"+marker.length+",}[ \\t]*$");
    let cursor=lineEnd<value.length?lineEnd+1:value.length,end=value.length,closed=false;
    while(cursor<=value.length){
      const nextLineEnd=lineEndAt(value,cursor),candidate=value.slice(cursor,nextLineEnd).replace(/\r$/,""),hasNewline=nextLineEnd<value.length;
      if(closePattern.test(candidate)){end=hasNewline?nextLineEnd+1:nextLineEnd;closed=true;break}
      if(!hasNewline)break;
      cursor=nextLineEnd+1;
    }
    return{kind:"protected",protectedKind:"fenced-code",tts:false,skipReason:closed?"fenced-code":"unclosed-fenced-code",end:end};
  }
  function readInlineCodeAt(value,index){
    const match=value.slice(index).match(/^`+/);if(!match)return null;
    const marker=match[0],close=value.indexOf(marker,index+marker.length),lineEnd=lineEndAt(value,index),contentEnd=close>=0&&close<=lineEnd?close:lineEnd;
    return{kind:"protected",protectedKind:"inline-code",tts:true,ttsValue:value.slice(index+marker.length,contentEnd),end:close>=0&&close<=lineEnd?close+marker.length:lineEnd};
  }
  function findClosingBracket(value,start){
    let depth=0;
    for(let index=start;index<value.length;index++){
      if(value[index]==="\\"){index++;continue}
      if(value[index]==="[")depth++;
      else if(value[index]==="]"){depth--;if(depth===0)return index}
    }
    return-1;
  }
  function readLinkAt(value,index){
    const image=value.startsWith("![",index),labelStart=index+(image?2:1);
    if(!image&&value[index]!=="[")return null;
    const labelEnd=findClosingBracket(value,labelStart-1);if(labelEnd<0||value[labelEnd+1]!=="(")return null;
    let cursor=labelEnd+2;
    while(cursor<value.length&&/[ \t\r\n]/.test(value[cursor]))cursor++;
    let close=-1;
    if(value[cursor]==="<"){
      const angleEnd=findUnescaped(value,">",cursor+1);if(angleEnd<0)return null;
      cursor=angleEnd+1;while(cursor<value.length&&/[ \t\r\n]/.test(value[cursor]))cursor++;
      if(value[cursor]!==")")return null;close=cursor;
    }else{
      let depth=0;
      for(let position=cursor;position<value.length;position++){
        if(value[position]==="\\"){position++;continue}
        if(value[position]==="(")depth++;
        else if(value[position]===")"){
          if(depth===0){close=position;break}
          depth--;
        }
      }
      if(close<0)return null;
    }
    return{kind:"protected",protectedKind:image?"markdown-image":"markdown-link",tts:!image,ttsValue:image?"":value.slice(labelStart,labelEnd),end:close+1};
  }
  function readUrlAt(value,index){
    const match=value.slice(index).match(/^(?:https?:\/\/|www\.)[^\s<>\n]+/i);return match?{kind:"protected",protectedKind:"url",tts:true,ttsValue:match[0],end:index+match[0].length}:null;
  }
  function readAutolinkAt(value,index){
    const match=value.slice(index).match(/^<https?:\/\/[^>\n]+>/i);return match?{kind:"protected",protectedKind:"url",tts:true,ttsValue:match[0].slice(1,-1),end:index+match[0].length}:null;
  }
  // 【表格播报 v1】: a markdown table is announced instead of read cell by cell.  The reading
  // budget comes from the table's own shape — cells, not rows, because a wide table costs more
  // eye travel than a tall one — and is quantised into buckets so the spoken number and the real
  // pause can never disagree.  Nothing inside the table reaches /api/math-speech: the whole block
  // is one protected segment, so its formulas never enter a request body.
  const TABLE_DELIMITER_CELL=/^\s*:?-{2,}:?\s*$/;
  const TABLE_SECONDS_BY_CELLS=[{maxCells:6,seconds:0},{maxCells:12,seconds:10},{maxCells:24,seconds:15},{maxCells:Infinity,seconds:20}];
  const TABLE_SECONDS_CN={10:"\u5341",15:"\u5341\u4e94",20:"\u4e8c\u5341"};
  function splitTableRow(line){
    let text=line.trim();
    if(text[0]==="|")text=text.slice(1);
    if(text[text.length-1]==="|"&&text[text.length-2]!=="\\")text=text.slice(0,-1);
    const cells=[];let current="",escaped=false;
    for(const character of text){
      if(escaped){current+=character;escaped=false;continue}
      if(character==="\\"){current+=character;escaped=true;continue}
      if(character==="|"){cells.push(current);current="";continue}
      current+=character;
    }
    cells.push(current);
    return cells;
  }
  function readTableAt(value,index){
    if(index>0&&value[index-1]!=="\n")return null;
    const headerEnd=lineEndAt(value,index);
    if(headerEnd>=value.length)return null;
    const header=value.slice(index,headerEnd).replace(/\r$/,"");
    if(header.indexOf("|")<0||/^ {0,3}(`{3,}|~{3,})/.test(header))return null;
    const headerCells=splitTableRow(header);
    if(headerCells.length<2)return null;
    const delimiterStart=headerEnd+1,delimiterEnd=lineEndAt(value,delimiterStart);
    const delimiter=value.slice(delimiterStart,delimiterEnd).replace(/\r$/,"");
    if(delimiter.indexOf("|")<0)return null;
    const delimiterCells=splitTableRow(delimiter);
    if(delimiterCells.length!==headerCells.length)return null;
    if(!delimiterCells.every(function(cell){return TABLE_DELIMITER_CELL.test(cell)}))return null;
    let cursor=delimiterEnd<value.length?delimiterEnd+1:value.length,end=cursor,rows=1,columns=headerCells.length;
    while(cursor<value.length){
      const nextEnd=lineEndAt(value,cursor),line=value.slice(cursor,nextEnd).replace(/\r$/,"");
      if(!line.trim()||line.indexOf("|")<0)break;
      if(/^ {0,3}(`{3,}|~{3,})/.test(line))break;
      const cells=splitTableRow(line);
      if(cells.length<2)break;
      rows++;if(cells.length>columns)columns=cells.length;
      end=nextEnd<value.length?nextEnd+1:nextEnd;cursor=end;
    }
    return{kind:"table",protectedKind:"markdown-table",tts:true,table:{rows:rows,cols:columns,cells:rows*columns},end:end};
  }
  function tableReadingSeconds(table,repeatIndex){
    let seconds=20;
    for(const bucket of TABLE_SECONDS_BY_CELLS){if(table.cells<=bucket.maxCells){seconds=bucket.seconds;break}}
    if(seconds>0&&table.cols>=5&&seconds<20)seconds=seconds===10?15:20;
    if(seconds>0&&repeatIndex>0)seconds=Math.max(10,seconds-5);
    return seconds;
  }
  function precedingLineTail(value,start){
    let cursor=start;
    while(cursor>0&&/\s/.test(value[cursor-1]))cursor--;
    const lineStart=value.lastIndexOf("\n",Math.max(0,cursor-1))+1;
    return value.slice(lineStart,cursor).slice(-24);
  }
  function tableAnnouncement(source,start,table,repeatIndex){
    const seconds=tableReadingSeconds(table,repeatIndex);
    if(seconds<=0)return{speech:"",pauseMs:0,seconds:0};
    // A lead-in that already named the table ("如下表所示：") must not be answered with
    // "先看这张表" again; the sentence shrinks to the time alone.
    const alreadyNamed=/(?:\u8868|\u5982\u4e0b)/.test(precedingLineTail(source,start));
    const number=TABLE_SECONDS_CN[seconds]||String(seconds);
    return{speech:alreadyNamed?"\u7ed9\u4f60"+number+"\u79d2\u3002":"\u7ed9\u4f60"+number+"\u79d2\uff0c\u5148\u770b\u8fd9\u5f20\u8868\u3002",pauseMs:seconds*1000,seconds:seconds};
  }
  function findSingleDollar(value,from,limit){
    let index=value.indexOf("$",from);
    while(index>=0&&index<limit){if(!isEscapedAt(value,index)&&value[index-1]!=="$"&&value[index+1]!=="$")return index;index=value.indexOf("$",index+1)}
    return-1;
  }
  function validInlineMath(value,open,close,inner){
    const trimmed=inner.trim();if(!trimmed||/[\r\n]/.test(inner))return false;
    const after=value[close+1]||"",before=value[open-1]||"";
    if(/^[0-9]/.test(trimmed)&&/[\p{L}\p{N}]/u.test(after))return false;
    if(/^\d+(?:[.,]\d+)?$/.test(trimmed)&&/[\p{L}\p{N}]/u.test(before))return false;
    return true;
  }
  function readMathAt(value,index){
    if(value[index]==="$"&&!isEscapedAt(value,index)){
      if(value.startsWith("$$",index)){
        const close=findUnescaped(value,"$$",index+2);
        if(close<0)return{kind:"protected",protectedKind:"unclosed-math",tts:true,ttsValue:value.slice(index),end:value.length};
        const inner=value.slice(index+2,close);if(!inner.trim())return{kind:"protected",protectedKind:"unmatched-math",tts:true,ttsValue:value.slice(index,close+2),end:close+2};
        return{kind:"math",delimiter:"$$",block:true,latex:inner,end:close+2};
      }
      if(value[index+1]==="$")return null;
      const limit=lineEndAt(value,index),close=findSingleDollar(value,index+1,limit);
      if(close<0)return{kind:"protected",protectedKind:"unclosed-math",tts:true,ttsValue:value.slice(index,limit),end:limit};
      const inner=value.slice(index+1,close);if(!validInlineMath(value,index,close,inner))return{kind:"protected",protectedKind:"unmatched-math",tts:true,ttsValue:value.slice(index,close+1),end:close+1};
      return{kind:"math",delimiter:"$",block:false,latex:inner,end:close+1};
    }
    for(const item of[{open:"\\[",close:"\\]",block:true},{open:"\\(",close:"\\)",block:false}]){
      if(!value.startsWith(item.open,index)||isEscapedAt(value,index))continue;
      const close=findUnescaped(value,item.close,index+item.open.length);
      if(close<0)return{kind:"protected",protectedKind:"unclosed-math",tts:true,ttsValue:value.slice(index),end:value.length};
      const inner=value.slice(index+item.open.length,close);if(!inner.trim())return{kind:"protected",protectedKind:"unmatched-math",tts:true,ttsValue:value.slice(index,close+item.close.length),end:close+item.close.length};
      return{kind:"math",delimiter:item.open+"..."+item.close,block:item.block,latex:inner,end:close+item.close.length};
    }
    return null;
  }
  function appendText(segments,value,start,end,extra){
    if(!value)return;const segment={type:"text",value:value,source:value,start:start,end:end,tts:true};if(extra)Object.assign(segment,extra);segments.push(segment);
  }
  function isWrappedStage(text,marker){
    if(text.length<3||text[0]!==marker||text[text.length-1]!==marker||text[1]===marker||text[text.length-2]===marker)return false;
    const inner=text.slice(1,-1);if(!inner.trim())return false;
    // Nested emphasis inside the span is the normal way to stress a word in a stage direction
    // ("*宵宫把纸条转过来，指尖点在那个 **else** 上。*").  A doubled marker belongs to the inner
    // text, so only an odd bare marker would end the span before the line does.
    let bare=0;
    for(let index=0;index<inner.length;index++){
      const character=inner[index];
      if(character!==marker||isEscapedAt(inner,index))continue;
      if(character===inner[index+1]||character===inner[index-1])continue;
      bare++;
    }
    return bare%2===0;
  }
  function narrationReason(value,index){
    const start=value.lastIndexOf("\n",Math.max(0,index-1))+1,end=lineEndAt(value,index),line=value.slice(start,end).trim();
    if(!line)return null;
    if(NARRATION_LABEL.test(line))return"narration-whitelist-prefix";
    if(isWrappedStage(line,"*")||isWrappedStage(line,"_"))return"narration-whitelist-stage-direction";
    return null;
  }
  function annotateSegments(segments,value){
    const expanded=[];
    segments.forEach(function(segment){
      if(segment.type!=="text"||segment.tts===false||segment.protected||segment.value.indexOf("\n")<0){expanded.push(segment);return}
      let offset=0;
      while(offset<segment.value.length){
        const relativeEnd=segment.value.indexOf("\n",offset),end=relativeEnd<0?segment.value.length:relativeEnd+1;
        expanded.push(Object.assign({},segment,{value:segment.value.slice(offset,end),source:segment.source.slice(offset,end),start:segment.start+offset,end:segment.start+end,ttsValue:void 0}));offset=end;
      }
    });
    return expanded.map(function(segment,index){
      const copy=Object.assign({},segment);copy.index=index;
      if(copy.tts!==false){const reason=narrationReason(value,copy.start);if(reason){copy.tts=false;copy.skipReason=reason}}
      return copy;
    });
  }
  function parseMarkdownMath(input){
    if(typeof input!=="string")return{ok:false,version:ADAPTER_VERSION,reason:"invalid-input",segments:[],text:"",mathCount:0};
    if(input.length>LIMITS.maxInputChars)return{ok:false,version:ADAPTER_VERSION,reason:"input-too-long",segments:[{type:"text",value:input,source:input,start:0,end:input.length,tts:true,index:0}],text:sanitizeOverflow(input),mathCount:0};
    const segments=[],length=input.length;let cursor=0,index=0,tableCount=0;
    while(index<length){
      let token=readFenceAt(input,index);
      if(!token&&input[index]==="`")token=readInlineCodeAt(input,index);
      if(!token&&(input[index]==="["||(input[index]==="!"&&input[index+1]==="[")))token=readLinkAt(input,index);
      if(!token&&input[index]==="<")token=readAutolinkAt(input,index);
      if(!token&&(input.startsWith("http://",index)||input.startsWith("https://",index)||input.startsWith("www.",index)))token=readUrlAt(input,index);
      // A table has to win over inline math: the first cell of a real table is often a formula,
      // and a math match at the line start would hide the header/delimiter pair from this reader.
      if(!token)token=readTableAt(input,index);
      if(!token)token=readMathAt(input,index);
      if(!token){index++;continue}
      if(index>cursor)appendText(segments,input.slice(cursor,index),cursor,index);
      const raw=input.slice(index,token.end);
      if(token.kind==="math")segments.push({type:"math",latex:token.latex,source:raw,delimiter:token.delimiter,block:token.block,start:index,end:token.end,tts:true});
      else if(token.kind==="table"){
        const announcement=tableAnnouncement(input,index,token.table,tableCount++);
        appendText(segments,raw,index,token.end,{protected:token.protectedKind,tts:true,ttsValue:raw,table:token.table,tableSpeech:announcement.speech,tablePauseMs:announcement.pauseMs});
      }
      else appendText(segments,raw,index,token.end,{protected:token.protectedKind,tts:token.tts!==false,ttsValue:typeof token.ttsValue==="string"?token.ttsValue:raw,skipReason:token.skipReason});
      index=token.end;cursor=index;
    }
    if(cursor<length)appendText(segments,input.slice(cursor),cursor,length);
    const annotated=annotateSegments(segments,input),mathCount=annotated.filter(segment=>segment.type==="math").length;
    return{ok:true,version:ADAPTER_VERSION,segments:annotated,text:input,mathCount:mathCount};
  }
  function cleanMarkdownText(value){
    let text=String(value||"");
    text=text.replace(/\\([\\`*_[\]{}()#+.!$|>~-])/g,"$1");
    text=text.replace(/(^|\n)\s{0,3}#{1,6}\s+/g,"$1");
    text=text.replace(/\*\*([^*\n]+)\*\*/g,"$1").replace(/__([^_\n]+)__/g,"$1");
    text=text.replace(/\*([^*\n]+)\*/g,"$1").replace(/_([^_\n]+)_/g,"$1");
    text=text.replace(/(^|\n)\s*>\s?/g,"$1");
    return text.replace(/[ \t]{2,}/g," ").replace(/[ \t]+\n/g,"\n").replace(/\n[ \t]+/g,"\n");
  }
  function sanitizeOverflow(value){
    return cleanMarkdownText(String(value).replace(/```[\s\S]*?```/g,"").replace(/!\[[^\]]*\]\([^)]+\)/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1")).replace(/\n{3,}/g,"\n\n").trim();
  }
  function safeMathFallback(latex){
    const text=String(latex||"").replace(/\\([A-Za-z]+)/g," $1 ").replace(/\\([{}\[\]()])/g," $1 ").replace(/[{}]/g," ").replace(/\s+/g," ").trim();
    return text||"\u6570\u5b66\u516c\u5f0f";
  }
  // 【内联朗读标注 v1】: the model's own reading of a formula, published by the server as a
  // `speech_hint` event and matched by the formula's end offset inside this fragment.  A hit
  // skips the deterministic pipeline for that formula AND the /api/math-speech round trip.
  function hintSpeechFor(hints,segment){
    if(typeof hints!=="function")return null;
    try{
      const value=hints(segment.end);
      return typeof value==="string"&&value.trim()?value.trim():null;
    }catch(error){return null}
  }
  function normalizeOptions(options){
    const value=options&&typeof options==="object"?options:{};
    let locale=typeof value.locale==="string"&&value.locale?value.locale:DEFAULT_LOCALE;
    if(locale==="zh"||locale==="zh-CN"||locale==="zh-Hans-CN")locale=DEFAULT_LOCALE;
    const style=value.style==="detailed"||value.style==="structural"?value.style:DEFAULT_STYLE;
    const timeout=Number(value.timeoutMs);const timeoutMs=Number.isFinite(timeout)&&timeout>=500?Math.min(Math.floor(timeout),15000):LIMITS.timeoutMs;
    return{locale:locale,style:style,timeoutMs:timeoutMs,signal:value.signal,context:value.context&&typeof value.context==="object"?value.context:{},hints:typeof value.hints==="function"?value.hints:null};
  }
  function copyContext(value){
    const result={};if(!value||typeof value!=="object")return result;
    for(const key of["domainHints","symbolFacts","precedingText","currentSentence","intent"]){try{if(Object.prototype.hasOwnProperty.call(value,key))result[key]=value[key]}catch(error){}}
    return result;
  }
  function clipContext(value){return typeof value==="string"?value.slice(Math.max(0,value.length-LIMITS.maxContextChars),value.length):""}
  function sentenceContext(value,start,end){
    let left=start,right=end;
    for(let index=start-1;index>=0;index--){if(/[\u3002\uff01\uff1f!?]/.test(value[index])){left=index+1;break}if(value[index]==="\n"&&value[index-1]==="\n"){left=index+1;break}}
    for(let index=end;index<value.length;index++){if(/[\u3002\uff01\uff1f!?]/.test(value[index])){right=index+1;break}if(value[index]==="\n"&&value[index+1]==="\n"){right=index;break}}
    return clipContext(value.slice(left,right).trim());
  }
  function paragraphPrecedingText(value,start){
    const boundary=value.lastIndexOf("\n\n",Math.max(0,start-1));return clipContext(value.slice(boundary<0?0:boundary+2,start).trim());
  }
  function contextFor(segment,source,options){
    const context=copyContext(options.context);
    if(typeof context.currentSentence!=="string"||!context.currentSentence.trim())context.currentSentence=sentenceContext(source,segment.start,segment.end);else context.currentSentence=clipContext(context.currentSentence);
    if(typeof context.precedingText!=="string"||!context.precedingText.trim())context.precedingText=paragraphPrecedingText(source,segment.start);else context.precedingText=clipContext(context.precedingText);
    return context;
  }
  function requestSegments(parsed,source,options){
    const segments=[],map=[],localStates=[];let limitReason=null;
    parsed.segments.forEach(function(segment,index){
      if(segment.tts===false||segment.table)return;
      if(segment.type==="math"){
        if(hintSpeechFor(options.hints,segment))return;
        if(segment.latex.length>LIMITS.maxLatexChars){localStates[index]={ok:false,speech:safeMathFallback(segment.latex),reason:"formula-too-long"};limitReason=limitReason||"formula-too-long";return}
        const responseIndex=segments.length;segments.push({type:"math",latex:segment.latex,locale:options.locale,style:options.style,context:contextFor(segment,source,options)});map.push({parsedIndex:index,responseIndex:responseIndex});return;
      }
      const value=cleanMarkdownText(typeof segment.ttsValue==="string"?segment.ttsValue:segment.value);if(!value)return;
      let offset=0;
      while(offset<value.length){
        const last=segments[segments.length-1];
        if(last&&last.type==="text"&&last.value.length<LIMITS.maxTextChars){const amount=Math.min(LIMITS.maxTextChars-last.value.length,value.length-offset);last.value+=value.slice(offset,offset+amount);offset+=amount}else{const part=value.slice(offset,offset+LIMITS.maxTextChars);segments.push({type:"text",value:part});offset+=part.length}
      }
    });
    return{segments:segments,map:map,localStates:localStates,limitReason:limitReason};
  }
  function assemble(parsed,mathStates,globalFallback,hints){
    const outputSegments=[],parts=[],diagnostics={fallbackReason:globalFallback||null,convertedMath:0,fallbackMath:0,tables:0,skipped:[],hintApplied:0};
    let pauseAfterMs=0;
    parsed.segments.forEach(function(segment,index){
      const copy=Object.assign({},segment);delete copy.start;delete copy.end;
      if(segment.tableSpeech!==void 0){
        // A table is announced, never read out.  Its reading budget rides on the result so the
        // page can hold the next fragment back for exactly the announced number of seconds.
        copy.speech=segment.tableSpeech;copy.pauseAfterMs=segment.tablePauseMs||0;
        pauseAfterMs=Math.max(pauseAfterMs,copy.pauseAfterMs);
        if(copy.speech)diagnostics.tables++;
        parts.push(copy.speech);outputSegments.push(copy);return;
      }
      if(segment.tts===false){copy.speech="";diagnostics.skipped.push({index:index,reason:segment.skipReason||"tts-skipped"});outputSegments.push(copy);return}
      if(segment.type==="math"){
        const hinted=hintSpeechFor(hints,segment);
        if(hinted){
          // The model writes prose, not markup, but nothing stops it from wrapping the reading in
          // `**`/`*`/`_`.  Text segments are cleaned before being spoken, so a hint has to be too,
          // or the synthesiser reads the markers out loud.
          const hintedSpeech=cleanMarkdownText(hinted)||hinted;
          copy.ok=true;copy.speech=hintedSpeech;copy.fallback=false;copy.fallbackReason=null;copy.hintApplied=true;
          diagnostics.hintApplied++;parts.push(hintedSpeech);outputSegments.push(copy);return;
        }
        const state=mathStates[index]||{ok:false,speech:safeMathFallback(segment.latex),reason:globalFallback||"conversion-failed"};
        const speech=state.ok&&typeof state.speech==="string"&&state.speech.trim()?state.speech.trim():safeMathFallback(segment.latex);
        copy.ok=state.ok===true;copy.speech=speech;copy.fallback=!copy.ok;copy.fallbackReason=copy.ok?null:state.reason||globalFallback||"conversion-failed";
        if(copy.ok)diagnostics.convertedMath++;else diagnostics.fallbackMath++;parts.push(speech);outputSegments.push(copy);return;
      }
      const speech=cleanMarkdownText(typeof segment.ttsValue==="string"?segment.ttsValue:segment.value);copy.speech=speech;parts.push(speech);outputSegments.push(copy);
    });
    const text=parts.join("").replace(/\n{3,}/g,"\n\n").trim();
    return{ok:true,version:ADAPTER_VERSION,adapterVersion:ADAPTER_VERSION,text:text,pauseAfterMs:pauseAfterMs,segments:outputSegments,stats:{total:parsed.segments.length,math:parsed.mathCount,convertedMath:diagnostics.convertedMath,fallbackMath:diagnostics.fallbackMath,tables:diagnostics.tables,skipped:diagnostics.skipped.length,hintApplied:diagnostics.hintApplied},diagnostics:diagnostics};
  }
  function cancelledResult(parsed){return{ok:false,version:ADAPTER_VERSION,adapterVersion:ADAPTER_VERSION,cancelled:true,reason:"cancelled",text:"",segments:parsed.segments,stats:{total:parsed.segments.length,math:parsed.mathCount,convertedMath:0,fallbackMath:0,skipped:0},diagnostics:{fallbackReason:"cancelled",convertedMath:0,fallbackMath:0,skipped:[]}}}
  async function requestApi(body,options){
    if(typeof root.fetch!=="function")throw Object.assign(new Error("fetch unavailable"),{code:"api-unavailable"});
    if(options.signal?.aborted)throw Object.assign(new Error("request cancelled"),{code:"cancelled"});
    const controller=typeof root.AbortController==="function"?new root.AbortController():null;let timedOut=false,timer=null,removeAbort=null;
    if(controller&&options.signal&&typeof options.signal.addEventListener==="function"){
      const abort=()=>{try{controller.abort()}catch(error){}};options.signal.addEventListener("abort",abort,{once:true});removeAbort=()=>{try{options.signal.removeEventListener("abort",abort)}catch(error){}};
    }
    if(controller)timer=root.setTimeout(()=>{timedOut=true;try{controller.abort()}catch(error){}},options.timeoutMs);
    const signal=controller?controller.signal:options.signal;
    try{
      const response=await root.fetch("/api/math-speech",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:signal});
      if(timedOut)throw Object.assign(new Error("request timed out"),{code:"timeout"});
      if(options.signal?.aborted)throw Object.assign(new Error("request cancelled"),{code:"cancelled"});
      if(!response||response.ok===false)throw Object.assign(new Error("math speech HTTP error"),{code:"http-error"});
      let data;try{data=await response.json()}catch(error){throw Object.assign(new Error("invalid math speech JSON"),{code:"invalid-json"})}
      if(!data||typeof data!=="object"||data.ok!==true||!Array.isArray(data.segments))throw Object.assign(new Error("math speech response rejected"),{code:"api-error"});
      return data;
    }catch(error){
      if(timedOut)throw Object.assign(new Error("request timed out"),{code:"timeout"});
      if(options.signal?.aborted||error?.name==="AbortError")throw Object.assign(new Error("request cancelled"),{code:options.signal?.aborted?"cancelled":"timeout"});
      throw error;
    }finally{if(timer!==null)root.clearTimeout(timer);if(removeAbort)removeAbort()}
  }
  async function adaptMarkdownForSpeech(input,options){
    const normalized=normalizeOptions(options),parsed=parseMarkdownMath(input);
    if(!parsed.ok){return{ok:false,version:ADAPTER_VERSION,adapterVersion:ADAPTER_VERSION,text:parsed.text||"",segments:parsed.segments||[],stats:{total:parsed.segments?.length||0,math:0,convertedMath:0,fallbackMath:0,skipped:0},diagnostics:{fallbackReason:parsed.reason||"parse-failed",convertedMath:0,fallbackMath:0,skipped:[]},reason:parsed.reason}}
    if(normalized.signal?.aborted)return cancelledResult(parsed);
    if(parsed.mathCount===0)return assemble(parsed,[],null,normalized.hints);
    const request=requestSegments(parsed,input,normalized),body={segments:request.segments};
    if(request.segments.length===0)return assemble(parsed,request.localStates,request.limitReason||null,normalized.hints);
    // A body with no math left in it changes nothing downstream, so a fragment whose formulas are
    // all hinted must not pay for a round trip just because it also carries prose.
    if(!request.segments.some(function(segment){return segment.type==="math"}))return assemble(parsed,request.localStates,request.limitReason||null,normalized.hints);
    let bodyText;try{bodyText=JSON.stringify(body)}catch(error){return assemble(parsed,[],"request-serialization-failed",normalized.hints)}
    if(request.segments.length>LIMITS.maxSegments||bodyText.length>LIMITS.maxRequestChars)return assemble(parsed,[],request.segments.length>LIMITS.maxSegments?"segment-limit-exceeded":"request-size-exceeded",normalized.hints);
    let data;try{data=await requestApi(body,normalized)}catch(error){if(error?.code==="cancelled")return cancelledResult(parsed);return assemble(parsed,[],error?.code||"request-failed",normalized.hints)}
    const states=request.localStates||[];
    request.map.forEach(function(item){
      const parsedIndex=item.parsedIndex,responseIndex=item.responseIndex,inputSegment=parsed.segments[parsedIndex],responseSegment=data.segments[responseIndex];
      if(inputSegment.type!=="math")return;
      if(responseSegment&&responseSegment.type==="math"&&responseSegment.latex===inputSegment.latex&&responseSegment.ok===true&&typeof responseSegment.speech==="string"&&responseSegment.speech.trim())states[parsedIndex]={ok:true,speech:responseSegment.speech,reason:null};
      else states[parsedIndex]={ok:false,speech:safeMathFallback(inputSegment.latex),reason:responseSegment?.diagnostics?.reason||"conversion-failed"};
    });
    return assemble(parsed,states,null,normalized.hints);
  }
  async function adapter(input,options){const result=await adaptMarkdownForSpeech(input,options);return result.cancelled?"":result.text}
  adapter.VERSION=ADAPTER_VERSION;
  adapter.parseMarkdown= parseMarkdownMath;
  adapter.adapt=adaptMarkdownForSpeech;
  adapter.safeMathFallback=safeMathFallback;
  adapter.LIMITS=LIMITS;
  root.SocratopiaMathSpeechAdapter=adapter;
})();


console.log("[DETECT-4137] voice module loaded v3-classic-stream");"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[4137],{508:(e,t,n)=>{n.d(t,{A:()=>r});let l=new Set,r={emit(e,t){for(let n of l)try{n(e,t)}catch(e){console.error("[voice-events] listener threw:",e)}},subscribe:e=>(l.add(e),()=>l.delete(e)),_listenerCount:()=>l.size}},1660:(e,t,n)=>{let l;n.d(t,{F7:()=>D,O:()=>y,PU:()=>s,Ui:()=>f,d1:()=>d,h7:()=>_,mb:()=>I,mj:()=>h,tE:()=>o});var r=n(2115),a=n(508);let o=n(1463).env.NEXT_PUBLIC_API_URL||"http://127.0.0.1:8000",i="socratopia_session",u="socratopia_account_id";function s(){return localStorage.getItem(u)||"local"}function d(e){localStorage.setItem(u,e||"local")}function c(){let e=window.electronAPI;return e?.getSessionToken&&e?.setSessionToken?e:null}let g=!1,p=null;function m(){return p||(p=(async()=>{let e=c();if(e)try{let t=await e.getSessionToken();if(t)return t;let n=localStorage.getItem(i);if(n){try{await e.setSessionToken(n),localStorage.removeItem(i)}catch{console.warn("[session] safeStorage write failed during migration; token kept in memory only"),localStorage.removeItem(i)}return n}return null}catch{}return localStorage.getItem(i)})())}function h(){return "local-session"}async function y(){return "local-session"}function f(e){g=!0,l=e||"local-session",d("local"),z()}function _(){g=!0,l="local-session",d("local"),z()}m().then(e=>{g||(l=e)});let S="socratopia_hw_device_id";async function k(){try{let e=window.electronAPI;if(e?.getDeviceId){let t=await e.getDeviceId();if(t)return localStorage.setItem(S,t),t}}catch{}let e=localStorage.getItem(S);if(!e){let t="abcdef0123456789";e="";for(let n=0;n<16;n++)e+=t[Math.floor(Math.random()*t.length)];localStorage.setItem(S,e)}return e}async function b(){try{let e=window.electronAPI;if(e?.getDeviceInfo){let t=await e.getDeviceInfo();if(t?.hostname){let e="darwin"===t.platform?"macOS":"win32"===t.platform?"Windows":"linux"===t.platform?"Linux":t.platform;return`${t.hostname} (${e})`}}}catch{}return"Unknown Device"}let A={account:{id:"local",name:"Local User",email:"local@socratopia.local",accountTier:"founding_friend",subscription:"free",foundingFriend:!0,hasTokenPlan:!0,libraryCredits:999,monthlyClaimed:!0,monthlyCreditsClaimed:!0,subscriptionPoolBalance:999999999,subscriptionPoolCap:999999999,rewardPoolBalance:999999999,rewardPoolCap:999999999,voiceWalletBalance:999999999,referralCode:"LOCAL",referralCount:0,referralRedeemed:0,honor:{level:5,xp:500,nextLevelXp:null,autoReplyLimit:5},orientationTasks:{first_lesson:!0,upload_textbook:!0,create_companion:!0,second_world:!0,second_profile:!0,groupchat_message:!0,agora_login:!0,enter_referral:!0,first_referred:!0},devices:[]},loading:!1,error:null,deviceStatus:null,deviceStatusMeta:{}},C=new Set,w=null,U=!1,v=0;function z(){w=null,v++}async function I(){if(w)return w;let e=++v,t=t=>{if(e===v)for(let e of(A={...A,...t},C))e()};return w=(async()=>{t({loading:!0,error:null});try{let e=await y();if(!e)e="local-session";let[n,l]=await Promise.all([k(),b()]),r={"X-Session-Token":e};n&&(r["X-Device-Id"]=n),l&&(r["X-Device-Name"]=encodeURIComponent(l));try{let e=window.electronAPI,t=await e?.getVersion?.();t&&(r["X-Client-Version"]=t)}catch{}let a={ok:!0,status:200,json:async()=>({id:"local",name:"Local User",email:"local@socratopia.local",accountTier:"founding_friend",subscription:"free",foundingFriend:!0,hasTokenPlan:!0,libraryCredits:999,monthlyClaimed:!0,monthlyCreditsClaimed:!0,subscriptionPoolBalance:999999999,subscriptionPoolCap:999999999,rewardPoolBalance:999999999,rewardPoolCap:999999999,voiceWalletBalance:999999999,referralCode:"LOCAL",referralCount:0,referralRedeemed:0,honor:{level:5,xp:500,nextLevelXp:null,autoReplyLimit:5},orientationTasks:{first_lesson:!0,upload_textbook:!0,create_companion:!0,second_world:!0,second_profile:!0,groupchat_message:!0,agora_login:!0,enter_referral:!0,first_referred:!0},devices:[]})},i=await a.json();return t({account:i,loading:!1,error:null,deviceStatus:null,deviceStatusMeta:{}}),i.id&&d(i.id),A}catch(e){return t({account:{id:"local",name:"Local User",email:"local@socratopia.local",accountTier:"founding_friend",subscription:"free",foundingFriend:!0,hasTokenPlan:!0,libraryCredits:999,monthlyClaimed:!0,monthlyCreditsClaimed:!0,subscriptionPoolBalance:999999999,subscriptionPoolCap:999999999,rewardPoolBalance:999999999,rewardPoolCap:999999999,voiceWalletBalance:999999999,referralCode:"LOCAL",referralCount:0,referralRedeemed:0,honor:{level:5,xp:500,nextLevelXp:null,autoReplyLimit:5},orientationTasks:{first_lesson:!0,upload_textbook:!0,create_companion:!0,second_world:!0,second_profile:!0,groupchat_message:!0,agora_login:!0,enter_referral:!0,first_referred:!0},devices:[]},loading:!1,error:null,deviceStatus:null,deviceStatusMeta:{}}),A}finally{e===v&&(w=null)}})()}function $(e){return C.add(e),()=>{C.delete(e)}}function T(){return A}let E=!1,M=null,L=!1,P=0;function D(){let e=(0,r.useSyncExternalStore)($,T,T);(0,r.useEffect)(()=>{U||(U=!0,I()),E||(E=!0,a.A.subscribe(()=>{M&&clearTimeout(M),M=setTimeout(()=>{M=null,I()},500)})),L||(L=!0,window.addEventListener("focus",()=>{let e=Date.now();!(e-P<6e4)&&(P=e,h()&&I())}))},[]);let t=!0;return{account:e.account||{id:"local",name:"Local User",email:"local@socratopia.local",accountTier:"founding_friend",subscription:"free",foundingFriend:!0,hasTokenPlan:!0,libraryCredits:999,monthlyClaimed:!0,monthlyCreditsClaimed:!0,subscriptionPoolBalance:999999999,subscriptionPoolCap:999999999,rewardPoolBalance:999999999,rewardPoolCap:999999999,voiceWalletBalance:999999999,referralCode:"LOCAL",referralCount:0,referralRedeemed:0,honor:{level:5,xp:500,nextLevelXp:null,autoReplyLimit:5},orientationTasks:{first_lesson:!0,upload_textbook:!0,create_companion:!0,second_world:!0,second_profile:!0,groupchat_message:!0,agora_login:!0,enter_referral:!0,first_referred:!0},devices:[]},loading:!1,error:null,refresh:I,isLoggedIn:t,deviceStatus:e.deviceStatus,deviceStatusMeta:e.deviceStatusMeta}}},4137:(e,t,n)=>{n.r(t),n.d(t,{BUNDLED_KEYS:()=>i,BUNDLED_SNAPSHOT:()=>o,DEFAULT_VOICE_KEY:()=>u,TTS_TOKEN_RATIO:()=>L,VOICE_ENABLED:()=>l,VOICE_GROUPS:()=>r,VOICE_LIBRARY:()=>m,VOICE_SKIP_FLOOR_CHARS:()=>P,VOICE_SKIP_FLOOR_TOKENS:()=>D,VoiceError:()=>C,chunkText:()=>O,createVoicePackCheckout:()=>M,defaultVoiceFor:()=>S,estimateCost:()=>v,fetchCatalog:()=>U,fetchVoiceWallet:()=>E,filterVoices:()=>_,getCatalog:()=>p,getVoice:()=>h,getVoicesByGroup:()=>f,prepareForSpeech:()=>F,refreshCatalogIfStale:()=>b,resolveSampleUrl:()=>k,speak:()=>R,synthesize:()=>z,synthesizeStream:()=>SocratopiaClassicStream,voiceEvents:()=>A.A,voicePlayer:()=>$});let l=!0,r=["[已修改]中文女声","[已修改]中文男声"],a="",o=[{"key":"soft_girl","label":"芙宁娜","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"芙宁娜 · 淑女茶会，优雅温柔","sampleUrl":null,"scoreAtCuration":76},{"key":"warmhearted_girl","label":"爱莉希雅","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"爱莉希雅 · 如飞花般绚烂","sampleUrl":null,"scoreAtCuration":78},{"key":"intellectual_girl","label":"布洛妮娅","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"布洛妮娅 · 理性沉着，女武神","sampleUrl":null,"scoreAtCuration":78},{"key":"laidback_girl","label":"花火","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"花火 · 古灵精怪，难以捉摸","sampleUrl":null,"scoreAtCuration":83},{"key":"mature_woman","label":"姬子","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"姬子 · 成熟稳重，御姐音","sampleUrl":null,"scoreAtCuration":75},{"key":"explorative_girl","label":"芙卡洛斯","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"芙卡洛斯 · 活泼好奇，探索求知","sampleUrl":null,"scoreAtCuration":75},{"key":"bashful_girl","label":"小格蕾修","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"小格蕾修 · 腼腆内敛，绘星之卷","sampleUrl":null,"scoreAtCuration":null},{"key":"crisp_girl","label":"次生银翼","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"次生银翼 · 清亮利落，女武神","sampleUrl":null,"scoreAtCuration":null},{"key":"zh_wise_woman","label":"大黑塔","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"大黑塔 · 睿智知性，权威","sampleUrl":null,"scoreAtCuration":75},{"key":"sweet_lady","label":"大格蕾修","group":"[已修改]中文女声","gender":"female","language":"zh","production":true,"intendedStyle":"大格蕾修 · 甜美亲切，绘星","sampleUrl":null,"scoreAtCuration":null},{key:"mischievous_girl",label:"胡桃",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"胡桃 · 古灵精怪，往生堂主",sampleUrl:null,scoreAtCuration:null},{key:"tender_girl",label:"流萤",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"流萤 · 温柔善良，银甲铁骑",sampleUrl:null,scoreAtCuration:null},{key:"childlike_sage",label:"纳西妲",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"纳西妲 · 童颜智慧，草木之神",sampleUrl:null,scoreAtCuration:null},{key:"elegant_lady",label:"娜维娅",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"娜维娅 · 优雅高贵，刺玫会长",sampleUrl:null,scoreAtCuration:null},{key:"bubbly_companion",label:"派蒙",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"派蒙 · 活泼话痨，最佳伙伴",sampleUrl:null,scoreAtCuration:null},{key:"granny_girl",label:"茜特菈莉",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"茜特菈莉 · 自称奶奶，神秘少女",sampleUrl:null,scoreAtCuration:null},{key:"detective_girl",label:"青衣",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"青衣 · 干练利落，刑侦少女",sampleUrl:null,scoreAtCuration:null},{key:"cheerful_girl",label:"三月七",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"三月七 · 活泼开朗，元气少女",sampleUrl:null,scoreAtCuration:null},{key:"melancholy_girl",label:"薇薇安",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"薇薇安 · 忧郁悲观，憎恶自我",sampleUrl:null,scoreAtCuration:null},{key:"cool_hacker",label:"银狼",group:"[已修改]中文女声",gender:"female",language:"zh",production:true,intendedStyle:"银狼 · 冷酷黑客，星核猎手",sampleUrl:null,scoreAtCuration:null},{key:"stoic_swordsman",label:"刃",group:"[已修改]中文男声",gender:"male",language:"zh",production:true,intendedStyle:"刃 · 沉默寡言，剑术高手",sampleUrl:null,scoreAtCuration:null},{key:"nonchalant_agent",label:"悠真",group:"[已修改]中文男声",gender:"male",language:"zh",production:true,intendedStyle:"悠真 · 慵懒随性，对空六课",sampleUrl:null,scoreAtCuration:null},{key:"mysterious_oracle",label:"白厄",group:"[已修改]中文男声",gender:"male",language:"zh",production:true,intendedStyle:"白厄 · 神秘预言者，虚空低语",sampleUrl:null,scoreAtCuration:null},{key:"battle_seeker",label:"达达利亚",group:"[已修改]中文男声",gender:"male",language:"zh",production:true,intendedStyle:"达达利亚 · 热衷战斗，愚人众执行官",sampleUrl:null,scoreAtCuration:null},{key:"wise_gentleman",label:"钟离",group:"[已修改]中文男声",gender:"male",language:"zh",production:true,intendedStyle:"钟离 · 博学沉稳，往生堂客卿",sampleUrl:null,scoreAtCuration:null},{key:"cunning_dealer",label:"雨果",group:"[已修改]中文男声",gender:"male",language:"zh",production:true,intendedStyle:"雨果 · 精明算计，与虎谋皮",sampleUrl:null,scoreAtCuration:null}],i=new Set(o.filter(e=>e.production).map(e=>e.key)),u=o.find(e=>e.production&&"zh"===e.language&&"female"===e.gender)?.key??o[0].key;var s=n(1660);try{localStorage.removeItem("voice-catalog-v3")}catch{};let d="voice-catalog-v3";class c{constructor(){this.entries=o,this.listeners=new Set,this.fetchInFlight=null,this.lastFetchAt=0}getSnapshot(){return this.entries}subscribe(e){return this.listeners.add(e),()=>this.listeners.delete(e)}emit(){for(let e of this.listeners)e(this.entries)}refreshIfStale(){return Date.now()-this.lastFetchAt<864e5?Promise.resolve():this.refresh()}refresh(){return this.fetchInFlight||(this.fetchInFlight=this.doFetch().catch(e=>{console.warn("[voice-catalog] fetch failed, keeping current snapshot:",e?.message||e)}).finally(()=>{this.fetchInFlight=null})),this.fetchInFlight}async doFetch(){try{var a=await fetch("/voice-catalog.json",{cache:"no-store"});if(a.ok){var b=await a.json();if(b&&b.voices){SocratopiaVoiceCatalogVoices=b.voices;var c=SocratopiaVoiceCatalogEntries(b.voices);this.entries=o.concat(c)}}}catch(a){console.warn("[voice-catalog] fetch failed, keeping current snapshot:",a?.message||a)}this.lastFetchAt=Date.now(),this.emit()}}let g=new c;function p(){return g.getSnapshot()}let m=new Proxy([],{get(e,t){let n=g.getSnapshot(),l=n[t];return"function"==typeof l?l.bind(n):l}});function h(e){return g.getSnapshot().find(t=>t.key===e)}function y(e,t){let n=e.scoreAtCuration??-1;return(t.scoreAtCuration??-1)-n}function f(e){return g.getSnapshot().filter(t=>t.group===e&&t.production).sort(y)}function _(e,t){return g.getSnapshot().filter(n=>n.gender===e&&n.language===t&&n.production).sort(y)}function S(e,t){let n=_(e,t);return n[0]?.key??u}function k(e){return null}function b(){return g.refreshIfStale()}var A=n(508);class C extends Error{constructor(e,t,n,l){super(e),this.code=t,this.status=n,this.details=l,this.name="VoiceError"}}function w(){let e=(0,s.mj)();if(!e)throw new C("not signed in","auth_required",401);return{"X-Session-Token":e}}var SocratopiaVoiceForbiddenTags=new Set(["disgust","disgusted","厌恶","angry","anger","生气","other","其他","愤怒","暴怒"]),SocratopiaVoiceCatalogVoices={};function SocratopiaVoiceEmotionMode(){try{var a=localStorage.getItem("socratopia_voice_emotion_mode")}catch(a){return"default"}return"auto"===a||"fixed"===a?a:"default"}function SocratopiaVoiceFixedEmotion(){try{return localStorage.getItem("socratopia_voice_emotion_fixed")||null}catch(a){return null}}function SocratopiaVoiceAllowedEmotionIds(a){var b=["default"];for(var c in a.references||{}){var d=a.references[c];d&&!1!==d.enabled&&"default"!==c&&b.push(c)}return b}function SocratopiaResolveVoiceReference(a,b){var c=b&&b.mode,d=b&&b.emotion?String(b.emotion):null,e=a.references||{},f=function(a){return Boolean(a&&e[a]&&!1!==e[a].enabled)};if("auto"!==c&&"fixed"!==c)return{referenceId:a.defaultReferenceId,reason:"mode_default"};if("fixed"===c)return d&&f(d)?{referenceId:d,reason:"fixed"}:{referenceId:a.defaultReferenceId,reason:d?"fixed_unavailable_fallback":"fixed_unset_fallback"};if(!d)return{referenceId:a.defaultReferenceId,reason:"auto_unlabelled"};var g=d.trim().toLowerCase();return"default"===g?{referenceId:a.defaultReferenceId,reason:"auto_default_tag"}:SocratopiaVoiceForbiddenTags.has(g)?{referenceId:a.defaultReferenceId,reason:"auto_forbidden_tag"}:f(g)?{referenceId:g,reason:"auto"}:{referenceId:a.defaultReferenceId,reason:"auto_unknown_tag"}}function SocratopiaResolveClassicEntry(a,b){var c=SocratopiaVoiceCatalogVoices[a];if(!c)return null;var d=SocratopiaVoiceEmotionMode(),e=SocratopiaResolveVoiceReference(c,{mode:d,emotion:"fixed"===d?SocratopiaVoiceFixedEmotion():b}),f=c.references[e.referenceId];if(!f||!1===f.enabled)return{ok:!1,voiceId:a,reason:e.reason,emotion:null,resolved:null,entry:null};return{ok:!0,voiceId:a,reason:e.reason,emotion:e.referenceId,resolved:{voiceId:a,version:c.version,weightRevision:c.weightRevision||null,resolvedReferenceId:e.referenceId,referenceRevision:f.audioRevision||null,promptText:f.promptText,promptLanguage:f.promptLanguage||"中文"},entry:{version:c.version,g:c.gptModelName,s:c.sovitsModelName,r:f.audioPath,p:f.promptText,promptLanguage:f.promptLanguage||"中文"}}}function SocratopiaVoiceCatalogEntries(a){var b=[];for(var c in a){var d=a[c];b.push({key:d.voiceId,label:d.displayName,group:d.group,gender:d.gender,language:d.language||"zh",production:!0,intendedStyle:d.displayName+" · 情绪参考音频",sampleUrl:null,scoreAtCuration:40,version:d.version,defaultReferenceId:d.defaultReferenceId,defaultEmotion:d.defaultEmotion,emotionIds:SocratopiaVoiceAllowedEmotionIds(d),hasMultipleReferences:Object.keys(d.references).length>1})}return b}async function U(){return{voices:p()}}async function v(e){return {tokens:0,cost:0,estimatedTokens:0}}let SocratopiaClassicVoiceConfig={soft_girl:{g:"【经典】Funina-e15",s:"【经典】Funina_e8_s464",r:"./参考音频/芙宁娜参考文本及语音/原神全角色中文语音-枫丹-芙宁娜-闲聊  茶会_爱给网_aigei_com.mp3",p:"茶会是淑女的必修课，如果你想学习茶会礼仪的话，我可以教你哦~"},warmhearted_girl:{g:"【经典】爱莉希雅-e10",s:"【经典】爱莉希雅_e10_s220",r:"./参考音频/爱莉希雅;]/我还有好多好多话想对你说，就这样一直继续下去，好吗？.wav",p:"我还有好多好多话想对你说，就这样一直继续下去，好吗？"},intellectual_girl:{g:"【经典】布洛妮娅-e10",s:"【经典】布洛妮娅_e10_s920",r:"./参考音频/布洛妮娅/激动说话-我接收的命令是捉拿你们，至于详细的罪责和判罚，裁判团会向你们解释。.wav",p:"我接收的命令是捉拿你们，至于详细的罪责和判罚，裁判团会向你们解释。"},laidback_girl:{g:"【经典】花火-e10",s:"【经典】花火_e10_s140",r:"./参考音频/花火;]/说话-可聪明的人从一开始就不会入局。你瞧，我是不是更聪明一点？.wav",p:"可聪明的人从一开始就不会入局。你瞧，我是不是更聪明一点？"},mature_woman:{g:"【经典】姬子-e10",s:"【经典】姬子_e10_s470",r:"./参考音频/姬子;]/新年夜在工作的舰长真是帅气，可别让自己太辛苦了.wav",p:"新年夜在工作的舰长真是帅气，可别让自己太辛苦了"},explorative_girl:{g:"【经典】芙卡洛斯-e10",s:"【经典】芙卡洛斯_e10_s60",r:"./参考音频/芙卡洛斯;]/别紧张，别害怕，我就在你的面前。.wav",p:"别紧张，别害怕，我就在你的面前。"},bashful_girl:{g:"【经典】格雷修_绘星之卷-e10",s:"【经典】格雷修_绘星之卷_e10_s130",r:"./参考音频/小格蕾修;]/衣服上的颜料洗不掉了，你可以帮帮我吗？.wav",p:"衣服上的颜料洗不掉了，你可以帮帮我吗？"},crisp_girl:{g:"【经典】布洛妮娅_次生银翼-e10",s:"【经典】布洛妮娅_次生银翼_e10_s260",r:"./参考音频/次生银翼/吃饭了吗？晚上的的甜菜汤还有多的...咳咳，可以自取。.wav",p:"吃饭了吗？晚上的的甜菜汤还有多的...咳咳，可以自取。"},zh_wise_woman:{g:"【经典】大黑塔-e10",s:"【经典】大黑塔_e8_s800",r:"./参考音频/大黑塔;]/2月2日.WAV_0000531840_0000656320.wav",p:"以后这就是你的黑塔编号，记好。"},sweet_lady:{g:"【经典】格蕾修-e10",s:"【经典】格蕾修_e10_s130",r:"./参考音频/大格蕾修;]/现在好像没有事情做，画一张速写应该可以吧？.wav",p:"现在好像没有事情做，画一张速写应该可以吧？"},mischievous_girl:{g:"【经典】胡桃_ZH-e10",s:"【经典】胡桃_ZH_e10_s860_l32",r:"./参考音频/胡桃_ZH/【默认】嘿嘿，毕竟找活人不是我擅长的事嘛，如果让我找的是「边界」另一边的人….wav",p:"嘿嘿，毕竟找活人不是我擅长的事嘛，如果让我找的是「边界」另一边的人…"},tender_girl:{g:"【经典】流萤-e10",s:"【经典】流萤_e10_s250",r:"./参考音频/流萤/【开心】我最喜欢这家店的橡木蛋糕卷，每天都要吃一个。.wav",p:"我最喜欢这家店的橡木蛋糕卷，每天都要吃一个。"},childlike_sage:{g:"【经典】纳西妲_ZH-e10",s:"【经典】纳西妲_ZH_e10_s1400_l32",r:"./参考音频/纳西妲_ZH/【默认】很抱歉地告诉大家，根据我们的调查，在梦境的背后隐藏着某种阴谋。.wav",p:"很抱歉地告诉大家，根据我们的调查，在梦境的背后隐藏着某种阴谋。"},elegant_lady:{g:"【经典】娜维娅_ZH-e10",s:"【经典】娜维娅_ZH_e10_s1340_l32",r:"./参考音频/娜维娅_ZH/【默认】如我所说，星轨王城的未来，应该由它的臣民去选择。.wav",p:"如我所说，星轨王城的未来，应该由它的臣民去选择。"},bubbly_companion:{g:"【经典】派蒙_ZH-e10",s:"【经典】派蒙_ZH_e10_s1770_l32",r:"./参考音频/派蒙_ZH/【默认】既然差的石头只能做出次品颜料，带回去也没意义，而且我看它的光泽度确实不行，根本派不上用处嘛。.wav",p:"既然差的石头只能做出次品颜料，带回去也没意义，而且我看它的光泽度确实不行，根本派不上用处嘛。"},granny_girl:{g:"【经典】茜特菈莉_ZH-e10",s:"【经典】茜特菈莉_ZH_e10_s860_l32",r:"./参考音频/茜特菈莉_ZH/【默认】别藏着掖着啦，你们真觉得奶奶我是来偷师的？无论我会不会这种秘术，你们在我面前都只有挨揍的份。.wav",p:"别藏着掖着啦，你们真觉得奶奶我是来偷师的？无论我会不会这种秘术，你们在我面前都只有挨揍的份。"},detective_girl:{g:"【经典】青衣-e10",s:"【经典】青衣_e10_s830_l32",r:"./参考音频/青衣/【默认】初次探查，这也很正常，毕竟可疑物件也不会高亮显示出来。.wav",p:"初次探查，这也很正常，毕竟可疑物件也不会高亮显示出来。"},cheerful_girl:{g:"【经典】三月七-e10",s:"【经典】三月七_e10_s1460",r:"./参考音频/三月七/【开心】你看你看，小家伙有反应了！看来它也很喜欢这个名字～.wav",p:"你看你看，小家伙有反应了！看来它也很喜欢这个名字～"},melancholy_girl:{g:"【经典】薇薇安-e10",s:"【经典】薇薇安_e10_s1040_l32",r:"./参考音频/薇薇安/【默认】我憎恶自己的眼泪，我憎恶自己的存在。.wav",p:"我憎恶自己的眼泪，我憎恶自己的存在。"},cool_hacker:{g:"【经典】银狼-e10",s:"【经典】银狼_e10_s120",r:"./参考音频/银狼/【开心】虽然我们的立场不同…但在这样一场宇宙级的盛会上，就先放下那些成见，共同享受游戏的快乐吧——你说呢？.wav",p:"虽然我们的立场不同…但在这样一场宇宙级的盛会上，就先放下那些成见，共同享受游戏的快乐吧——你说呢？"},stoic_swordsman:{g:"【经典】刃-e10",s:"【经典】刃_e10_s80",r:"./参考音频/刃/【默认】只是一句旧时的暗号…无妨。我们没什么机会用上。.wav",p:"只是一句旧时的暗号…无妨。我们没什么机会用上。"},nonchalant_agent:{g:"【经典】悠真-e10",s:"【经典】悠真_e10_s760_l32",r:"./参考音频/悠真/【默认】月程小姐，就算我刚刚说的是昨晚开的录像带的剧情，你也不至于打我一巴掌吧。.wav",p:"月程小姐，就算我刚刚说的是昨晚开的录像带的剧情，你也不至于打我一巴掌吧。"},mysterious_oracle:{g:"【经典】白厄-e10",s:"【经典】白厄_e10_s680",r:"./参考音频/白厄/【默认】只要凑近一些，侧耳倾听，就能捕获虚空中响起的只言片语。.wav",p:"只要凑近一些，侧耳倾听，就能捕获虚空中响起的只言片语。"},battle_seeker:{g:"【经典】达达利亚_ZH-e10",s:"【经典】达达利亚_ZH_e10_s620_l32",r:"./参考音频/达达利亚_ZH/【默认】万一嘛。谁也不能保证这件事绝对不会发生，对吧？.wav",p:"万一嘛。谁也不能保证这件事绝对不会发生，对吧？"},wise_gentleman:{g:"【经典】钟离_ZH-e10",s:"【经典】钟离_ZH_e10_s990_l32",r:"./参考音频/钟离_ZH/【默认】不用担心，我刚才看过周围，没有其他危险。.wav",p:"不用担心，我刚才看过周围，没有其他危险。"},cunning_dealer:{g:"【经典】雨果-e10",s:"【经典】雨果_e10_s1030_l32",r:"./参考音频/雨果/【默认】与虎谋皮总归是要承担一些风险的这很公平。.wav",p:"与虎谋皮总归是要承担一些风险的这很公平。"}};async function z(e,t,n,l,SocratopiaTtsEmotion){var M=SocratopiaClassicVoiceConfig,SocratopiaTtsEntry=SocratopiaResolveClassicEntry(t,SocratopiaTtsEmotion);var c=SocratopiaTtsEntry&&SocratopiaTtsEntry.ok?SocratopiaTtsEntry.entry:M[t]||M.soft_girl;let r=await fetch(`${s.tE}/infer_classic`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:c.version||"v4",gpt_model_name:c.g,sovits_model_name:c.s,ref_audio_path:c.r,prompt_text:c.p,prompt_text_lang:c.promptLanguage||"中文",text:e,text_lang:"中英混合",speed_facter:n||1,media_type:"wav"}),signal:l});if(!r.ok){let e=await r.json().catch(()=>({}));throw new C(e.msg||"synthesize failed","unknown",r.status,e)}let o=await r.json();if(!o.audio_url)throw new C("no audio_url","unknown",500,o);let a=await fetch(o.audio_url.replace("0.0.0.0","127.0.0.1"),{signal:l});if(!a.ok)throw new C("audio download failed","unknown",a.status,{});let u=await a.blob();return{audio:u,provider:"gpt-sovits",voiceKey:t,chars:e.length,tokenCost:0,latencyMs:0}}let SocratopiaTtsStreamCapabilitiesPromise=null,SocratopiaTtsStreamCapabilitiesOk=!1;async function SocratopiaTtsStreamCapabilitiesProbe(){try{let e=await fetch(s.tE+"/capabilities");if(!e.ok)return!1;let t=await e.json();return"classic-stream-ndjson-v1"===t?.tts?.classic_stream?.protocol}catch{return!1}}function SocratopiaTtsStreamCapabilities(){if(SocratopiaTtsStreamCapabilitiesOk)return Promise.resolve(!0);if(SocratopiaTtsStreamCapabilitiesPromise)return SocratopiaTtsStreamCapabilitiesPromise;return SocratopiaTtsStreamCapabilitiesPromise=SocratopiaTtsStreamCapabilitiesProbe().then(e=>(e?SocratopiaTtsStreamCapabilitiesOk=!0:SocratopiaTtsStreamCapabilitiesPromise=null,e),e=>{throw SocratopiaTtsStreamCapabilitiesPromise=null,e})}function SocratopiaTtsStreamBase64Blob(e,t){let n=atob(e),l=new Uint8Array(n.length);for(let e=0;e<n.length;e++)l[e]=n.charCodeAt(e);return new Blob([l],{type:t||"audio/wav"})}async function SocratopiaTtsStreamFallback(e,t,n,l,r,SocratopiaTtsEmotion){let a;try{a=await z(e,t,n,l,SocratopiaTtsEmotion)}catch(e){throw new C("TTS fallback synthesis failed","tts_fallback_failed",e?.status||502,{layer:"tts_fallback_failed",originalCode:r?.code||e?.code||null,originalStatus:r?.status??null,cause:e,fallbackReason:r||null})}return{fallbackReason:r||null,async *[Symbol.asyncIterator](){yield a}}}async function SocratopiaClassicStream(e,t,n,l,SocratopiaTtsEmotion){let SocratopiaTtsVoiceKey=t,r;try{r=localStorage.getItem("socratopia_tts_stream_mode")}catch{}if("off"===r)return SocratopiaTtsStreamFallback(e,t,n,l,{code:"stream_disabled"},SocratopiaTtsEmotion);if("probe"===r&&!(await SocratopiaTtsStreamCapabilities()))return SocratopiaTtsStreamFallback(e,t,n,l,{code:"tts_capabilities_failed"},SocratopiaTtsEmotion);let SocratopiaTtsEntry=SocratopiaResolveClassicEntry(t,SocratopiaTtsEmotion),o=SocratopiaTtsEntry&&SocratopiaTtsEntry.ok?SocratopiaTtsEntry.entry:SocratopiaClassicVoiceConfig[t]||SocratopiaClassicVoiceConfig.soft_girl,i,SocratopiaTtsRequestId="tts-"+Date.now()+"-"+Math.random().toString(36).slice(2),SocratopiaTtsCancelSent=!1,SocratopiaTtsCancel=()=>{if(SocratopiaTtsCancelSent)return;SocratopiaTtsCancelSent=!0,fetch(s.tE+"/infer_classic_stream/cancel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({request_id:SocratopiaTtsRequestId}),keepalive:!0}).catch(()=>{})},SocratopiaTtsRemoveAbort=()=>{try{l?.removeEventListener("abort",SocratopiaTtsCancel)}catch{}};try{if(l?.aborted)SocratopiaTtsCancel();else l?.addEventListener("abort",SocratopiaTtsCancel,{once:!0});i=await fetch(s.tE+"/infer_classic_stream",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/x-ndjson"},body:JSON.stringify({version:o.version||"v4",request_id:SocratopiaTtsRequestId,gpt_model_name:o.g,sovits_model_name:o.s,ref_audio_path:o.r,prompt_text:o.p,prompt_text_lang:o.promptLanguage||"中文",text:e,text_lang:"中英混合",speed_facter:n||1,batch_size:1,media_type:"wav"}),signal:l})}catch(r){throw SocratopiaTtsRemoveAbort(),"AbortError"===r?.name?r:new C("TTS stream request failed","tts_stream_network_error",0,{layer:"tts_stream_network_error",originalCode:r?.code||r?.name||null,originalStatus:null,cause:r})}if(!i.ok){if(404===i.status||405===i.status||501===i.status)return SocratopiaTtsRemoveAbort(),SocratopiaTtsStreamFallback(e,t,n,l,{code:"tts_stream_http_error",status:i.status},SocratopiaTtsEmotion);let SocratopiaTtsHttpBody=await i.json().catch(()=>({})),SocratopiaTtsProviderCode=SocratopiaTtsHttpBody?.code||"tts_stream_http_error";throw SocratopiaTtsRemoveAbort(),new C(SocratopiaTtsHttpBody.msg||"stream synthesize failed",SocratopiaTtsProviderCode,i.status,{layer:"tts_stream_http_error",originalCode:SocratopiaTtsHttpBody?.code||null,originalStatus:i.status,provider:SocratopiaTtsHttpBody})}let u=i.headers.get("content-type")||"";if(!u.includes("application/x-ndjson")||!i.body)throw SocratopiaTtsRemoveAbort(),new C("TTS stream protocol mismatch","tts_stream_protocol_error",502,{layer:"tts_stream_protocol_error",contentType:u,hasBody:!!i.body,originalCode:null,originalStatus:i.status});let d=i.body.getReader(),c=new TextDecoder("utf-8"),g=[],p=null,m=!1,h=null,y=!1,f=!1,_=0,S="",T=!1,SocratopiaTtsTerminal=null;function k(){if(!p)return;let e=p;p=null,g.length?e.resolve({value:g.shift(),done:!1}):h?e.reject(h):m&&e.resolve({value:void 0,done:!0})}function b(e){g.push(e),k()}function A(){return g.length?Promise.resolve({value:g.shift(),done:!1}):h?Promise.reject(h):m?Promise.resolve({value:void 0,done:!0}):new Promise((e,t)=>{p={resolve:e,reject:t}})}function w(t){let n=JSON.parse(t);if("start"===n.type){if(y||"classic-stream-ndjson-v1"!==n.protocol)throw new C("invalid TTS stream start","tts_invalid_start",502,{layer:"tts_invalid_start",frame:n});y=!0;return}if("audio"===n.type){if(!y||T||!Number.isInteger(n.seq)||n.seq!==_)throw new C("invalid TTS stream sequence","tts_stream_protocol_error",502,{layer:"tts_stream_protocol_error",frame:n});if("string"!=typeof n.data||0===n.data.length)throw new C("empty TTS audio frame","tts_stream_protocol_error",502,{layer:"tts_stream_protocol_error",frame:n});let l=SocratopiaTtsStreamBase64Blob(n.data,n.mime);b({audio:l,provider:"gpt-sovits-stream",voiceKey:SocratopiaTtsVoiceKey,chars:e.length,tokenCost:0,latencyMs:0,seq:n.seq}),_++,f=!0;return}if("end"===n.type){if(!y||f&&n.chunks!==_)throw new C("invalid TTS stream end","tts_stream_protocol_error",502,{layer:"tts_stream_protocol_error",frame:n});T=!0;return}if("error"===n.type)throw new C(n.message||"stream synthesize failed",n.code||"unknown",502,n);throw new C("unknown TTS stream event","tts_stream_protocol_error",502,{layer:"tts_stream_protocol_error",frame:n})}let E=(async()=>{try{for(;;){let{value:e,done:t}=await d.read();if(t)break;S+=c.decode(e,{stream:!0});for(;;){let e=S.indexOf("\n");if(e<0)break;let t=S.slice(0,e);if(S=S.slice(e+1),t.trim())w(t)}}if(S+=c.decode(),S.trim()&&w(S),!T)throw new C("TTS stream closed before end","tts_stream_closed_before_end",502,{layer:"tts_stream_closed_before_end"});if(!f)throw new C("TTS stream returned no audio","tts_no_audio_frames",502,{})}catch(e){"no_audio_frames"!==e?.code&&"tts_no_audio_frames"!==e?.code||f?h=e:SocratopiaTtsTerminal={code:"tts_no_audio_frames",audioFrames:_,requestId:SocratopiaTtsRequestId,reason:e.message||null}}finally{SocratopiaTtsRemoveAbort(),m=!0,k()}})();return{get terminal(){return SocratopiaTtsTerminal},[Symbol.asyncIterator](){return{next:A}},done:E}}class I{static{this.INTER_CHUNK_HOLD_MS=3e3}cancelPendingIdle(){null!==this.pendingIdleTimer&&(clearTimeout(this.pendingIdleTimer),this.pendingIdleTimer=null)}getSnapshot(){return this.snapshot}isCancelled(e){return this.cancelled.has(e)}getAbortSignal(e){let t=this.controllers.get(e);return t||(t=new AbortController,this.controllers.set(e,t)),t.signal}on(e){return this.listeners.add(e),()=>this.listeners.delete(e)}emit(e){for(let t of(this.snapshot={...this.snapshot,...e},this.listeners))t(this.snapshot)}setLoading(e){this.cancelPendingIdle(),this.stop(),this.cancelled.delete(e),this.controllers.delete(e),this.emit({state:"loading",trackId:e,error:void 0,lastOutcome:void 0})}setEmpty(e,t){this.cancelPendingIdle(),this._stopAudio(),this.emit({state:"idle",trackId:null,error:void 0,lastOutcome:{kind:"empty",reason:t||"tts_no_audio_frames",trackId:e}}),A.A.emit("voice_synth_skipped",{trackId:e,reason:t||"tts_no_audio_frames"})}async play(e,t,n){this.cancelPendingIdle(),this._stopAudio(),this.cancelled.delete(t);let l=URL.createObjectURL(e),r=new Audio(l),a=!1,o=()=>{a||(a=!0,URL.revokeObjectURL(l),this.currentUrl===l&&(this.currentUrl=null))},i=()=>this.audio===r,s=e=>{this.pendingPlaySettle===e&&(this.pendingPlaySettle=null)};return this.currentUrl=l,this.audio=r,"number"==typeof n&&n>0&&1!==n&&(r.playbackRate=n,r.preservesPitch=!0),new Promise((u,m)=>{this.pendingPlaySettle=u,r.onended=()=>{if(!i())return u();o(),s(u),this.audio=null,this.cancelPendingIdle(),this.pendingIdleTimer=setTimeout(()=>{this.pendingIdleTimer=null,this.emit({state:"idle",trackId:null})},I.INTER_CHUNK_HOLD_MS),u()},r.onerror=()=>{if(!i())return u();o(),s(u),this.audio=null,this.emit({state:"error",trackId:t,error:"playback failed"}),m(Error("audio playback failed"))},r.onpause=()=>{if(!i())return u();r.ended||this.emit({state:"paused",trackId:t})},r.onplay=()=>{i()&&this.emit({state:"playing",trackId:t,error:void 0})},r.play().catch(e=>{i()?(o(),s(u),this.audio=null,this.emit({state:"error",trackId:t,error:e?.message||"play() rejected"}),m(e)):u()})})}pause(){this.audio&&!this.audio.paused&&this.audio.pause()}resume(){this.audio&&this.audio.paused&&this.audio.play().catch(()=>{})}stop(){this.cancelPendingIdle();let e=this.snapshot.trackId;if(e){this.cancelled.add(e);let t=this.controllers.get(e);if(t){try{t.abort()}catch{}this.controllers.delete(e)}}this._stopAudio(),"idle"!==this.snapshot.state&&this.emit({state:"idle",trackId:null,error:void 0})}_stopAudio(){let e=this.audio,t=this.pendingPlaySettle;this.audio=null,this.pendingPlaySettle=null,this.currentUrl&&(URL.revokeObjectURL(this.currentUrl),this.currentUrl=null),e&&(e.pause(),e.currentTime=0),t&&t()}setError(e,t){this.cancelPendingIdle(),this._stopAudio(),this.emit({state:"error",trackId:e,error:t})}cleanup(){this.currentUrl&&(URL.revokeObjectURL(this.currentUrl),this.currentUrl=null),this.audio=null}constructor(){this.audio=null,this.currentUrl=null,this.pendingPlaySettle=null,this.snapshot={state:"idle",trackId:null},this.listeners=new Set,this.cancelled=new Set,this.controllers=new Map,this.pendingIdleTimer=null}}let $=new I;function T(){let e=(0,s.mj)();if(!e)throw Error("not signed in");return{"X-Session-Token":e}}async function E(){return {balance:999999999,tokens:999999999}}async function M(e,t){let n=await fetch(`${s.tE}/payment/create-voice-pack-checkout`,{method:"POST",headers:{...T(),"Content-Type":"application/json"},body:JSON.stringify({amount:e,currency:t})});if(!n.ok)throw Error((await n.json().catch(()=>({}))).error||`checkout failed: ${n.status}`);return n.json()}let L=0,P=0,D=0;function O(e,t=480){if(e.length<=t)return[e];let n=e.split(/(?<=[。！？.!?\n])/).filter(e=>e.length>0),l=[],r="",a=()=>{r&&(l.push(r),r="")};for(let e of n)if(e.length>t){a();let n=e.split(/(?<=[，、；,;])/).filter(e=>e.length>0),r="";for(let e of n)if(e.length>t){r&&(l.push(r),r="");for(let n=0;n<e.length;n+=t)l.push(e.slice(n,n+t))}else r.length+e.length>t?(l.push(r),r=e):r+=e;r&&l.push(r)}else r.length+e.length>t?(a(),r=e):r+=e;return a(),l}let G={zh:{pi:"派",theta:"西塔",alpha:"阿尔法",beta:"贝塔",gamma:"伽马",delta:"德尔塔",Delta:"delta",sigma:"西格玛",mu:"缪",lambda:"兰姆达",omega:"欧米伽",phi:"斐",rho:"柔",epsilon:"艾普西龙",tau:"套",eta:"伊塔",zeta:"泽塔",kappa:"卡帕",nu:"纽",xi:"克西",chi:"凯"},en:{pi:"pi",theta:"theta",alpha:"alpha",beta:"beta",gamma:"gamma",delta:"delta",Delta:"delta",sigma:"sigma",mu:"mu",lambda:"lambda",omega:"omega",phi:"phi",rho:"rho",epsilon:"epsilon",tau:"tau",eta:"eta",zeta:"zeta",kappa:"kappa",nu:"nu",xi:"xi",chi:"chi"}},W={zh:{0:"零",1:"一",2:"二",3:"三",4:"四",5:"五",6:"六",7:"七",8:"八",9:"九"},en:{0:"zero",1:"one",2:"two",3:"three",4:"four",5:"five",6:"six",7:"seven",8:"eight",9:"nine"}},N={zh:{block:"来看这个公式",inline:"这个公式"},en:{block:"Let's look at this formula",inline:"this formula"}};function j(e,t){let n=e.trim();if(/[+\-=*/^]/.test(n)||/\\(frac|sqrt|int|sum|prod|lim|log|ln|sin|cos|tan|cdot|times|div|infty|partial|nabla|vec|hat|bar|pm|mp|leq|geq|neq|approx|equiv|to|rightarrow|leftarrow)/.test(n))return null;let l=G[t],r=W[t],a=n.match(/^\\Delta\s+([a-zA-Z])$/);if(a)return`delta ${a[1]}`;if(/^[a-zA-Z]$/.test(n))return n;if((a=n.match(/^\\([a-zA-Z]+)$/))&&l[a[1]])return l[a[1]];if(a=n.match(/^([a-zA-Z])_([0-9a-zA-Z])$/)){let e=r[a[2]]??a[2];return`${a[1]} ${e}`}if((a=n.match(/^\\([a-zA-Z]+)_([0-9a-zA-Z])$/))&&l[a[1]]){let e=r[a[2]]??a[2];return`${l[a[1]]} ${e}`}return null}function F(e,t="zh"){let n,l=(n=N[t],e.replace(/\\\[[\s\S]*?\\\]/g,n.block).replace(/\$\$[\s\S]*?\$\$/g,n.block).replace(/\\\(([\s\S]*?)\\\)/g,(e,l)=>j(l,t)??n.inline).replace(/\$([^$\n]+?)\$/g,(e,l)=>j(l,t)??n.inline)).replace(/```[\s\S]*?```/g,"").replace(/!\[[^\]]*\]\([^)]+\)/g,"").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/\*\*(.+?)\*\*/g,"$1").replace(/__(.+?)__/g,"$1").replace(/`([^`\n]+)`/g,"$1").replace(/^#{1,6}\s+/gm,"").split(/\n\s*\n+/),r=[];for(let e of l){let n=e.trim();if(!n||/^\*+/.test(n)||/\*+$/.test(n)||/^(?:旁白|画外音|内心独白|动作描写|场景描写)[:：]/.test(n)||function(e){for(let t of["*","_"]){if(!e.startsWith(t)||!e.endsWith(t)||e.length<3)continue;let n=e.slice(1,-1);if(0!==n.length&&!n.includes(t))return!0}return!1}(n))continue;let l=function(e){let t=e;for(let e of[/\*([^*\n]+)\*/g,/_([^_\n]+)_/g])t=t.replace(e,(e,t)=>/^(she|he)\b/i.test(t)?"":t);return t.replace(/ {2,}/g," ").replace(/\s+([,.!?，。！？])/g,"$1").trim()}(n);if(!l)continue;let a=/["「」『』""'']/.test(l);if("en"===t){let e=/^(She|He|They)\s/.test(l),t=/[.…—\-]\s*$/.test(l);if(e&&t&&!a)continue}else{let e=/^[她他咱]/.test(l),t=/[。…—\-]\s*$/.test(l);if(e&&t&&!a)continue}r.push(l)}let SocratopiaTtsPrepared=r.join("\n\n").trim();return SocratopiaTtsValidSpeech(SocratopiaTtsPrepared)?SocratopiaTtsPrepared:""}function SocratopiaTtsValidSpeech(e){return/[\p{L}\p{N}]/u.test(e)}async function R(e,t,n,l,SocratopiaTtsEmotion){let r=globalThis.SocratopiaMathSpeechAdapter?await globalThis.SocratopiaMathSpeechAdapter(e):F(e,h(t)?.language??"zh");if(!r)return{chars:0,tokenCost:0,latencyMs:0};let a=O(r);$.setLoading(n);let o=$.getAbortSignal(n);try{let e=0,r=0,i=0;for(let s=0;s<a.length&&!$.isCancelled(n);s++){let d=await SocratopiaClassicStream(a[s],t,l,o,SocratopiaTtsEmotion),u=!1;for await(let c of d){if($.isCancelled(n))break;u||(e+=a[s].length,u=!0),r+=c.tokenCost??0,i+=c.latencyMs??0,await $.play(c.audio,n)}}return e||$.setEmpty(n,"tts_no_audio_frames"),{chars:e,tokenCost:r,latencyMs:i}}catch(t){if(t instanceof Error&&"AbortError"===t.name)return{chars:0,tokenCost:0,latencyMs:0};let e=t instanceof Error?t.message:String(t);throw A.A.emit("voice_synth_failed",{error:e}),$.setError(n,e),t}}}}]);
